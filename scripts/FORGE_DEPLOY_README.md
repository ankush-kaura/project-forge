# Forge Deploy — Operator Guide

Turns a backend-dropped manifest into a live subdomain on `<slug>.<FORGE_SUFFIX>.<FORGE_DOMAIN>`.

---

## How It Works

1. The backend (container) writes a JSON manifest to the deploy queue:
   ```
   /var/lib/docker/volumes/forge_builds/_data/_deploy_queue/<session>.json
   ```
2. `forge-deploy-watcher.sh` polls the queue every 10 s (configurable).
3. For each manifest with `status=queued` it calls `forge-deploy.py`, which:
   - Generates a `docker-compose.yml` if absent (picks a free port in 38000-39000).
   - Runs `docker compose -p forge-<slug> up -d --build`.
   - Adds/updates a `<slug>.forge` A-record under `FORGE_DOMAIN` via the Hostinger MCP.
   - Writes an nginx server block and reloads nginx.
   - Updates the manifest to `status=deployed` with the resolved port and public URL.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGE_DEPLOY_ENABLED` | `0` | **Must be `1` to allow execution.** Safety gate. |
| `FORGE_QUEUE_DIR` | `/var/lib/docker/volumes/forge_builds/_data/_deploy_queue` | Queue directory path. |
| `FORGE_DEPLOY_SCRIPT` | `<script-dir>/forge-deploy.py` | Absolute path to the deploy script. |
| `FORGE_POLL_INTERVAL` | `10` | Seconds between queue scans. |

---

## Prerequisites

### 1. Hostinger MCP credentials

- `/root/.hermes/config.yaml` must contain `mcp_servers.hostinger.env.HOSTINGER_API_TOKEN`.
- MCP binary must exist at `/root/.hermes/node/bin/hostinger-api-mcp`.

### 2. DNS

**Option A — Per-slug records (default, automatic):**
`forge-deploy.py` adds a `<slug>.forge` A-record for every deploy. No manual DNS work needed, but new records must propagate before TLS HTTP-01 challenges work (~1-5 min).

**Option B — Wildcard record (recommended for production):**
Add once in Hostinger:
```
*.<FORGE_SUFFIX>.<FORGE_DOMAIN>  A  <FORGE_VPS_IP>  TTL 300
```
New slugs resolve immediately. `forge-deploy.py` still writes per-slug records (harmless and more explicit).

### 3. TLS

**Wildcard cert (recommended):**
```bash
certbot certonly --dns-hostinger \
  -d "*.<FORGE_SUFFIX>.<FORGE_DOMAIN>" \
  --dns-hostinger-credentials /root/.hostinger-certbot.ini
```
Then edit `NGINX_CONF_TEMPLATE` in `forge-deploy.py` to add:
```nginx
listen 443 ssl;
ssl_certificate     /etc/letsencrypt/live/<FORGE_SUFFIX>.<FORGE_DOMAIN>/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/<FORGE_SUFFIX>.<FORGE_DOMAIN>/privkey.pem;
```

**Per-slug HTTP-01 (simpler, no wildcard DNS plugin needed):**
After a successful deploy:
```bash
certbot --nginx -d <slug>.<FORGE_SUFFIX>.<FORGE_DOMAIN>
```
Wait for DNS propagation first.

### 4. Host packages

```bash
apt install -y nginx python3
pip3 install pyyaml          # optional; forge-deploy.py has a stdlib fallback
# docker compose v2 plugin must be installed
docker compose version
```

---

## Enabling the Watcher

### Quick test (foreground):
```bash
FORGE_DEPLOY_ENABLED=1 bash /opt/forge/forge-deploy-watcher.sh
```

### Systemd service:
```bash
cp /tmp/project-forge/scripts/forge-deploy.py         /opt/forge/
cp /tmp/project-forge/scripts/forge-deploy-watcher.sh /opt/forge/
chmod +x /opt/forge/forge-deploy-watcher.sh

# Create /etc/systemd/system/forge-deploy-watcher.service
# (full unit file is in the comment block at the top of forge-deploy-watcher.sh)

systemctl daemon-reload
systemctl enable --now forge-deploy-watcher
journalctl -fu forge-deploy-watcher
```

To pass `FORGE_DEPLOY_ENABLED=1` to the service, create `/etc/forge/forge.env`:
```
FORGE_DEPLOY_ENABLED=1
```
The unit file references it via `EnvironmentFile=-/etc/forge/forge.env`.

---

## Processed Manifests

| Directory | Meaning |
|-----------|---------|
| `_deploy_queue/*.json` | Pending (status=queued) or in-flight |
| `_deploy_queue/_done/` | Successfully deployed |
| `_deploy_queue/_failed/` | Failed; investigate logs before retrying |

---

## Security Warning

**This service executes code written by the AI model on the VPS host.**

- Every deployed workspace gets `docker compose up --build`, which runs an arbitrary `Dockerfile`.
- nginx configs are written to `/etc/nginx/sites-available/` and reloaded automatically.
- DNS A-records are created/modified via the Hostinger API.

**Review the manifest and workspace contents before setting `FORGE_DEPLOY_ENABLED=1`.**

Recommended safeguards:
- Run docker with a restricted default seccomp profile (default Docker behaviour).
- Consider a dedicated non-root user with limited `sudo` for nginx reload only.
- Audit the queue directory periodically; do not leave `_failed/` entries unreviewed.
- Rotate `HOSTINGER_API_TOKEN` if the VPS is compromised.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Watcher exits immediately | `FORGE_DEPLOY_ENABLED` not set to `1` |
| DNS tool fails | Token in `/root/.hermes/config.yaml`; MCP binary path |
| nginx reload fails | `nginx -t` manually; inspect `/var/log/nginx/error.log` |
| Port conflict | Inspect `docker ps` for conflicting port bindings |
| Container won't start | `docker compose -p forge-<slug> logs` in the workspace |
| Manifest stuck in queue | Check `_failed/`; re-queue by moving back and resetting `status` to `queued` |
