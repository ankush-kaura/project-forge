#!/usr/bin/env bash
# =============================================================================
# forge-deploy-watcher.sh
# =============================================================================
# Watches the forge deploy queue and dispatches forge-deploy.py for each
# manifest with status="queued".
#
# Run manually:  bash forge-deploy-watcher.sh
# Or install as a systemd service — see the block below.
#
# ---------------------------------------------------------------------------
# SYSTEMD SERVICE INSTALLATION
# ---------------------------------------------------------------------------
#
# 1. Copy this script and forge-deploy.py to /opt/forge/:
#       mkdir -p /opt/forge
#       cp forge-deploy-watcher.sh /opt/forge/
#       cp forge-deploy.py         /opt/forge/
#       chmod +x /opt/forge/forge-deploy-watcher.sh
#
# 2. Create the unit file at /etc/systemd/system/forge-deploy-watcher.service:
#
#   [Unit]
#   Description=Forge Deploy Queue Watcher
#   After=docker.service network-online.target
#   Requires=docker.service
#
#   [Service]
#   Type=simple
#   EnvironmentFile=-/etc/forge/forge.env     # optional: set FORGE_DEPLOY_ENABLED=1
#   ExecStart=/opt/forge/forge-deploy-watcher.sh
#   Restart=always
#   RestartSec=15
#   StandardOutput=journal
#   StandardError=journal
#
#   [Install]
#   WantedBy=multi-user.target
#
# 3. Enable and start:
#       systemctl daemon-reload
#       systemctl enable --now forge-deploy-watcher
#       journalctl -fu forge-deploy-watcher
#
# ---------------------------------------------------------------------------
# PREREQUISITES
# ---------------------------------------------------------------------------
#
# DNS:
#   Option A (wildcard) — Recommended:
#     Add a wildcard A-record in your DNS provider:
#       *.<FORGE_SUFFIX>.<FORGE_DOMAIN> -> <FORGE_VPS_IP>
#     forge-deploy.py still writes per-slug records; the wildcard is a fallback.
#
#   Option B (per-slug, default):
#     forge-deploy.py adds each <slug>.forge A-record automatically via the
#     Hostinger MCP.  No manual DNS work needed per deploy.
#
# TLS:
#   Wildcard cert (recommended):
#     certbot certonly --dns-<provider> -d "*.<FORGE_SUFFIX>.<FORGE_DOMAIN>"
#     Then add to each nginx server block:
#       ssl_certificate     /etc/letsencrypt/live/<FORGE_SUFFIX>.<FORGE_DOMAIN>/fullchain.pem;
#       ssl_certificate_key /etc/letsencrypt/live/<FORGE_SUFFIX>.<FORGE_DOMAIN>/privkey.pem;
#     (Edit the NGINX_CONF_TEMPLATE in forge-deploy.py to add listen 443 ssl.)
#
#   Per-slug HTTP-01 (simpler, one cert per slug):
#     After forge-deploy.py runs:
#       certbot --nginx -d <slug>.<FORGE_SUFFIX>.<FORGE_DOMAIN>
#     This only works once the per-slug A-record has propagated (~1-5 min).
#
# Required host packages:
#   - docker (compose v2 plugin: `docker compose` subcommand)
#   - nginx
#   - python3  (stdlib only; optionally PyYAML: pip3 install pyyaml)
#   - /root/.hermes/config.yaml  with HOSTINGER_API_TOKEN
#   - /root/.hermes/node/bin/hostinger-api-mcp  (MCP binary)
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEPLOY_ENABLED="${FORGE_DEPLOY_ENABLED:-0}"
QUEUE_DIR="${FORGE_QUEUE_DIR:-/var/lib/docker/volumes/forge_builds/_data/_deploy_queue}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="${FORGE_DEPLOY_SCRIPT:-${SCRIPT_DIR}/forge-deploy.py}"
DONE_DIR="${QUEUE_DIR}/_done"
FAILED_DIR="${QUEUE_DIR}/_failed"
POLL_INTERVAL="${FORGE_POLL_INTERVAL:-10}"

# ---------------------------------------------------------------------------
# Safety gate
# ---------------------------------------------------------------------------
if [[ "${DEPLOY_ENABLED}" != "1" ]]; then
    echo "[forge-watcher] FORGE_DEPLOY_ENABLED is not set to '1'. Exiting."
    echo "                Set FORGE_DEPLOY_ENABLED=1 to allow running generated code on this host."
    exit 1
fi

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------
if [[ ! -f "${DEPLOY_SCRIPT}" ]]; then
    echo "[forge-watcher] ERROR: deploy script not found: ${DEPLOY_SCRIPT}" >&2
    exit 1
fi

if [[ ! -d "${QUEUE_DIR}" ]]; then
    echo "[forge-watcher] Creating queue dir: ${QUEUE_DIR}"
    mkdir -p "${QUEUE_DIR}"
fi

mkdir -p "${DONE_DIR}" "${FAILED_DIR}"

echo "[forge-watcher] Started. Watching: ${QUEUE_DIR}  (poll every ${POLL_INTERVAL}s)"
echo "[forge-watcher] Deploy script: ${DEPLOY_SCRIPT}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
get_status() {
    # Extract "status" field from a JSON file with python3 (no jq dependency)
    python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(d.get('status', ''))
except Exception:
    print('')
" "$1"
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
while true; do
    shopt -s nullglob
    manifests=("${QUEUE_DIR}"/*.json)
    shopt -u nullglob

    for manifest in "${manifests[@]}"; do
        [[ -f "${manifest}" ]] || continue

        status="$(get_status "${manifest}")"

        if [[ "${status}" != "queued" ]]; then
            continue
        fi

        slug="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('slug','unknown'))" "${manifest}" 2>/dev/null || echo "unknown")"
        echo "[forge-watcher] Dispatching deploy for: ${manifest}  (slug=${slug})"

        if python3 "${DEPLOY_SCRIPT}" "${manifest}"; then
            echo "[forge-watcher] Deploy succeeded: ${slug}"
            mv "${manifest}" "${DONE_DIR}/"
        else
            echo "[forge-watcher] Deploy FAILED: ${slug}  (manifest kept in _failed/)" >&2
            mv "${manifest}" "${FAILED_DIR}/"
        fi
    done

    sleep "${POLL_INTERVAL}"
done
