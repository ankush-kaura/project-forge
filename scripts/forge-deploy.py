#!/usr/bin/env python3
"""
forge-deploy.py — Deploy a forge project from a manifest file.

Usage:
    python3 forge-deploy.py /path/to/<session>.json

Manifest schema (input):
    {
        "session":   "<uuid>",
        "slug":      "<app-slug>",        # e.g. "myapp"
        "subdomain": "<slug>.forge",      # e.g. "myapp.forge"
        "url":       "<full url>",        # informational
        "workspace": "/abs/path/to/src",  # directory with Dockerfile (and optionally docker-compose.yml)
        "status":    "queued"
    }

On success the manifest is updated in-place with:
    "status":    "deployed"
    "port":      <int>
    "public_url": "http://<slug>.<FORGE_SUFFIX>.<FORGE_DOMAIN>"
"""

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DOMAIN         = os.environ.get("FORGE_DOMAIN", "example.com")
FORGE_SUFFIX   = os.environ.get("FORGE_SUFFIX", "forge")  # <slug>.<suffix>.<domain>
VPS_IP         = os.environ.get("FORGE_VPS_IP", "127.0.0.1")
PORT_RANGE     = range(38000, 39001)
NGINX_AVAIL    = Path("/etc/nginx/sites-available")
NGINX_ENABLED  = Path("/etc/nginx/sites-enabled")
HERMES_CONFIG  = Path("/root/.hermes/config.yaml")
MCP_BINARY     = Path("/root/.hermes/node/bin/hostinger-api-mcp")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def step(msg: str):
    print(f"\n[FORGE] {msg}")

def fail(msg: str):
    print(f"\n[FORGE ERROR] {msg}", file=sys.stderr)
    sys.exit(1)

def run(cmd, **kwargs):
    """Run a command; raise on non-zero exit."""
    step(f"Running: {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    result = subprocess.run(cmd, check=True, capture_output=True, text=True, **kwargs)
    if result.stdout.strip():
        print(result.stdout.strip())
    return result

# ---------------------------------------------------------------------------
# DNS helpers (mirrored from update-dns.py)
# ---------------------------------------------------------------------------

def _load_hostinger_token() -> str:
    try:
        import yaml  # optional stdlib fallback below
        with open(HERMES_CONFIG) as f:
            cfg = yaml.safe_load(f)
        return cfg["mcp_servers"]["hostinger"]["env"]["HOSTINGER_API_TOKEN"]
    except Exception:
        pass
    # Fallback: manual YAML key extraction (no PyYAML)
    import re
    text = HERMES_CONFIG.read_text()
    m = re.search(r"HOSTINGER_API_TOKEN:\s*['\"]?([A-Za-z0-9_\-\.]+)['\"]?", text)
    if m:
        return m.group(1)
    fail("Cannot read HOSTINGER_API_TOKEN from " + str(HERMES_CONFIG))


def call_tool(tool_name: str, arguments: dict = None) -> object:
    """
    Call a Hostinger MCP tool via JSON-RPC over stdio.
    Mirrors the pattern in update-dns.py exactly.
    """
    if arguments is None:
        arguments = {}

    token = _load_hostinger_token()

    proc = subprocess.Popen(
        [str(MCP_BINARY), "--stdio"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={"HOSTINGER_API_TOKEN": token, "PATH": "/usr/local/bin:/usr/bin:/bin"},
    )

    # Initialize
    init = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "forge-deploy", "version": "1.0.0"},
        },
    })
    proc.stdin.write(init + "\n")
    proc.stdin.flush()
    proc.stdout.readline()  # consume initialize response

    # Initialized notification
    notif = json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"})
    proc.stdin.write(notif + "\n")
    proc.stdin.flush()
    time.sleep(0.5)

    # Tool call
    tool_call = json.dumps({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    })
    proc.stdin.write(tool_call + "\n")
    proc.stdin.flush()
    time.sleep(5)

    line = proc.stdout.readline()
    proc.terminate()

    data = json.loads(line)
    content = data.get("result", {}).get("content", [])
    if content:
        raw = content[0].get("text", "{}")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw
    return None


def upsert_dns_a_record(slug: str):
    """
    Ensure an A-record '<slug>.<FORGE_SUFFIX>' exists under DOMAIN -> VPS_IP.
    Uses the same read-modify-write pattern as update-dns.py.
    """
    record_name = f"{slug}.{FORGE_SUFFIX}"
    step(f"Upserting DNS A-record: {record_name}.{DOMAIN} -> {VPS_IP}")

    current_dns = call_tool("DNS_getDNSRecordsV1", {"domain": DOMAIN})
    if not isinstance(current_dns, list):
        fail(f"Unexpected DNS response: {current_dns!r}")

    # Remove any existing record with same name (we will re-add it)
    new_zone = [r for r in current_dns if r.get("name") != record_name]

    new_record = {
        "name": record_name,
        "type": "A",
        "records": [{"content": VPS_IP}],
        "ttl": 300,
    }
    new_zone.append(new_record)
    print(f"  Adding/updating: {record_name}.A -> {VPS_IP}")

    result = call_tool("DNS_updateDNSRecordsV1", {"domain": DOMAIN, "zone": new_zone, "overwrite": True})
    step(f"DNS update result: {json.dumps(result, indent=2)[:300]}")

# ---------------------------------------------------------------------------
# Port helpers
# ---------------------------------------------------------------------------

def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def pick_free_port() -> int:
    for port in PORT_RANGE:
        if not _port_in_use(port):
            return port
    fail(f"No free port in range {PORT_RANGE.start}-{PORT_RANGE.stop - 1}")


def port_for_existing_compose(compose_path: Path) -> int | None:
    """
    Try to extract an already-bound host port from an existing docker-compose.yml
    for a container named after the slug (best-effort; returns None if unclear).
    """
    text = compose_path.read_text()
    import re
    # Look for  "38xxx:..." style port mapping
    m = re.search(r'"?(3[89]\d{3}):(\d+)"?', text)
    if m:
        return int(m.group(1))
    return None

# ---------------------------------------------------------------------------
# docker-compose.yml generation
# ---------------------------------------------------------------------------

COMPOSE_TEMPLATE = """\
version: "3.8"
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "{port}:8080"
    environment:
      - PORT=8080
"""


def ensure_compose(workspace: Path, slug: str) -> tuple[Path, int]:
    """
    Return (compose_path, host_port).
    If docker-compose.yml is absent, generate a minimal one.
    """
    compose_path = workspace / "docker-compose.yml"

    if compose_path.exists():
        step("docker-compose.yml already present — using it")
        port = port_for_existing_compose(compose_path)
        if port is None:
            step("Could not detect host port from existing compose; picking a free one")
            port = pick_free_port()
        else:
            step(f"Detected existing host port: {port}")
        return compose_path, port

    step("No docker-compose.yml found — generating minimal one")
    # Check Dockerfile exists
    if not (workspace / "Dockerfile").exists():
        fail(f"Workspace {workspace} has neither a docker-compose.yml nor a Dockerfile. Cannot deploy.")

    port = pick_free_port()
    compose_path.write_text(COMPOSE_TEMPLATE.format(port=port))
    step(f"Generated docker-compose.yml (host port {port} -> container port 8080)")
    return compose_path, port

# ---------------------------------------------------------------------------
# nginx helpers
# ---------------------------------------------------------------------------

NGINX_CONF_TEMPLATE = """\
# forge-deploy managed — do not edit manually
server {{
    listen 80;
    server_name {subdomain_full};

    access_log /var/log/nginx/forge-{slug}.access.log;
    error_log  /var/log/nginx/forge-{slug}.error.log;

    location / {{
        proxy_pass         http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }}
}}
"""


def write_nginx_conf(slug: str, port: int):
    subdomain_full = f"{slug}.{FORGE_SUFFIX}.{DOMAIN}"
    conf_content   = NGINX_CONF_TEMPLATE.format(
        slug=slug, subdomain_full=subdomain_full, port=port
    )
    conf_path    = NGINX_AVAIL / f"forge-{slug}.conf"
    symlink_path = NGINX_ENABLED / f"forge-{slug}.conf"

    step(f"Writing nginx config: {conf_path}")
    conf_path.write_text(conf_content)

    if symlink_path.exists() or symlink_path.is_symlink():
        symlink_path.unlink()
    symlink_path.symlink_to(conf_path)
    step(f"Symlinked: {symlink_path} -> {conf_path}")

    step("Testing nginx config")
    run(["nginx", "-t"])

    step("Reloading nginx")
    run(["systemctl", "reload", "nginx"])

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        fail("Usage: python3 forge-deploy.py <manifest.json>")

    manifest_path = Path(sys.argv[1])
    if not manifest_path.exists():
        fail(f"Manifest not found: {manifest_path}")

    # --- Load manifest ---
    step(f"Loading manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text())

    session   = manifest.get("session",   "")
    slug      = manifest.get("slug",      "")
    workspace = Path(manifest.get("workspace", ""))

    if not slug:
        fail("Manifest missing 'slug' field")
    if not workspace or not workspace.exists():
        fail(f"Manifest 'workspace' path does not exist: {workspace}")

    step(f"Deploying slug={slug!r}  session={session!r}  workspace={workspace}")

    # --- Ensure compose + port ---
    compose_path, port = ensure_compose(workspace, slug)
    step(f"Using host port: {port}")

    # --- Docker compose up ---
    project_name = f"forge-{slug}"
    step(f"Starting docker compose project: {project_name}")
    run(
        ["docker", "compose", "-p", project_name, "up", "-d", "--build"],
        cwd=str(workspace),
    )

    # --- DNS ---
    upsert_dns_a_record(slug)

    # --- nginx ---
    write_nginx_conf(slug, port)

    # --- Update manifest ---
    public_url = f"http://{slug}.{FORGE_SUFFIX}.{DOMAIN}"
    manifest["status"]     = "deployed"
    manifest["port"]       = port
    manifest["public_url"] = public_url
    manifest_path.write_text(json.dumps(manifest, indent=2))
    step(f"Manifest updated: status=deployed  port={port}  url={public_url}")

    print(f"\n[FORGE] Deploy complete: {public_url}")


if __name__ == "__main__":
    main()
