#!/usr/bin/env bash
# Configura worker-1 pra atender ao domínio de teste com TLS real via Pebble.
# Para o Caddy do podcubo temporariamente, sobe um nginx + Caddy novos com
# Pebble como ACME endpoint.
#
# Reverte com: scripts/teardown-worker.sh

set -euo pipefail

POC_DIR=$(cd "$(dirname "$0")/.." && pwd)
KEY="/var/mnt/data/dev-projects/podcubo/dev/workers/podcubo_key"
PORT="${WORKER_PORT:-2231}"
IP="${WORKER_IP:-192.168.122.12}"
HOST_IP="${HOST_IP:-192.168.122.1}"
DOMAIN="${TEST_DOMAIN:-meu-app-test.podcubo.dev}"

sshr() { ssh -i "$KEY" -p "$PORT" -o StrictHostKeyChecking=no -o LogLevel=ERROR "root@localhost" "$@"; }
scpr() { scp -i "$KEY" -P "$PORT" -o StrictHostKeyChecking=no -o LogLevel=ERROR "$@"; }

CA="$POC_DIR/out/pebble-ca.pem"
PEBBLE_CERT="$POC_DIR/config/pebble-cert.pem"
[[ -f "$CA" ]] || {
    echo "ERROR: $CA not found — fetch with:" >&2
    echo "  curl -sk https://localhost:15000/roots/0 > $CA" >&2
    exit 1
}
[[ -f "$PEBBLE_CERT" ]] || {
    echo "ERROR: $PEBBLE_CERT not found — generate with:" >&2
    echo "  cd config && openssl req -x509 ..." >&2
    exit 1
}

echo "[1/7] Uploading Pebble trust bundle..."
# Bundle contém:
#   - pebble-cert.pem: cert self-signed do servidor Pebble (trust na conexão HTTPS com ACME)
#   - pebble-ca.pem:   CA root do Pebble (trust nos certs que ele emite pras apps)
# Caddy usa `acme_ca_root` pro primeiro; o segundo é pro bundle final do sistema.
cat "$PEBBLE_CERT" "$CA" | sshr "cat > /root/pebble-trust.pem"

echo "[2/7] Uploading Caddyfile..."
cat <<EOF | sshr "cat > /root/Caddyfile"
{
    acme_ca https://$HOST_IP:14000/dir
    acme_ca_root /pebble-trust.pem
}

$DOMAIN {
    reverse_proxy localhost:8081
}
EOF

echo "[3/7] Uploading nginx config..."
cat <<'NGINX' | sshr "cat > /root/nginx-default.conf"
server {
    listen 8081 default_server;
    server_name _;
    location / {
        default_type text/html;
        return 200 "<html><body><h1>cubolab POC works</h1><p>served by nginx behind Caddy behind Pebble ACME</p></body></html>";
    }
}
NGINX

echo "[4/7] Stopping podcubo Caddy (frees ports 80/443)..."
sshr "su - podcubo -c 'XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user stop caddy'" || true

echo "[5/7] Cleaning previous cubolab containers..."
sshr "podman rm -f cubolab-nginx cubolab-caddy 2>/dev/null" || true

echo "[6/7] Starting cubolab-nginx (backend :8081)..."
sshr "podman run -d --name cubolab-nginx --network=host \
    -v /root/nginx-default.conf:/etc/nginx/conf.d/default.conf:ro,Z \
    docker.io/nginx:alpine" > /dev/null

echo "[7/7] Starting cubolab-caddy (ACME via Pebble)..."
sshr "podman run -d --name cubolab-caddy --network=host \
    -v /root/Caddyfile:/etc/caddy/Caddyfile:ro,Z \
    -v /root/pebble-trust.pem:/pebble-trust.pem:ro,Z \
    docker.io/caddy:2-alpine" > /dev/null

echo ""
echo "== Waiting for Caddy to obtain cert (up to 60s)..."
for i in $(seq 1 30); do
    sleep 2
    logs=$(sshr "podman logs cubolab-caddy 2>&1" || echo "")
    if echo "$logs" | grep -q "certificate obtained successfully"; then
        echo "   ✓ cert obtained"
        break
    fi
    if echo "$logs" | grep -qiE "fatal|error obtaining|failed to obtain"; then
        echo "   ✗ caddy reported error. Last logs:"
        echo "$logs" | tail -20
        exit 1
    fi
    printf "."
done
echo ""
echo ""
echo "Worker configured. Test with:"
echo ""
echo "  curl --cacert $CA --resolve $DOMAIN:443:$IP https://$DOMAIN"
