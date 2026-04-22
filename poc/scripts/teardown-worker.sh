#!/usr/bin/env bash
# Reverte as mudanças do setup-worker.sh — remove containers cubolab do worker
# e religa o Caddy do podcubo.

set -euo pipefail

KEY="/var/mnt/data/dev-projects/podcubo/dev/workers/podcubo_key"
PORT="${WORKER_PORT:-2231}"

sshr() { ssh -i "$KEY" -p "$PORT" -o StrictHostKeyChecking=no -o LogLevel=ERROR "root@localhost" "$@"; }

echo "[1/2] Removing cubolab containers..."
sshr "podman rm -f cubolab-nginx cubolab-caddy 2>/dev/null" || true

echo "[2/2] Starting podcubo Caddy..."
sshr "su - podcubo -c 'XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user start caddy'"

echo "Done. Worker restored to podcubo state."
