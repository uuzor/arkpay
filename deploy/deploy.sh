#!/usr/bin/env bash
# Ship the current working tree to the production Vultr instance and rebuild
# the API + web images. The server keeps its own /opt/arkpay/.env; it is never
# included in the archive.
#
# Usage: ./deploy/deploy.sh
# Requires: SSH access (see deploy/ssh-bootstrap.sh) to root@$VULTR_INSTANCE_IP.
set -euo pipefail
cd "$(dirname "$0")/.."

env_get() {
  grep -m1 "^$1=" .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

KEY="$(env_get VULTR_SSH_KEY_PATH)"
HOST="$(env_get VULTR_INSTANCE_IP)"
APP_URL="$(env_get PROD_APP_URL)"
API_URL="$(env_get PROD_API_URL)"
KEY="${KEY:-$PWD/.ssh/arkpay_vultr}"
HOST="${HOST:-139.84.249.48}"
ARCHIVE="${TMPDIR:-/tmp}/arkpay-deploy.tgz"

echo "== packaging"
tar czf "$ARCHIVE" \
  --exclude='node_modules' --exclude='.git' --exclude='.ssh' \
  --exclude='.local' --exclude='.cache' --exclude='.config' \
  --exclude='conversation-*.txt' --exclude='.env' --exclude='.env.*' \
  --exclude='apps/api/dist' --exclude='apps/web/dist' \
  --exclude='apps/web/.next' --exclude='*.zip' \
  apps package.json pnpm-lock.yaml pnpm-workspace.yaml \
  docker-compose.prod.yml Caddyfile .dockerignore deploy
tar tzf "$ARCHIVE" | grep -qE '(^|/)\.ssh/|arkpay_vultr' && {
  echo "refusing to ship SSH material" >&2; exit 1;
}
ls -lh "$ARCHIVE"

echo "== uploading to root@${HOST}:/opt/arkpay"
scp -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 \
  -o StrictHostKeyChecking=accept-new \
  "$ARCHIVE" "root@${HOST}:/opt/arkpay/arkpay-deploy.tgz"

echo "== building + recreating containers"
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "root@${HOST}" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/arkpay
# tar extracts over the previous tree, so a file deleted from the repo would
# survive here and be copied into the image. Clear the code, keep .env.
rm -rf apps deploy
rm -f package.json pnpm-lock.yaml pnpm-workspace.yaml \
      docker-compose.prod.yml Caddyfile .dockerignore
tar xzf arkpay-deploy.tgz
docker compose -f docker-compose.prod.yml up -d --build --force-recreate
docker compose -f docker-compose.prod.yml ps
REMOTE

echo "== smoke checks"
# Containers report "healthy" a few seconds before Caddy/API answer; retry.
for _ in $(seq 1 30); do
  curl -fsS --max-time 5 "${API_URL}/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS --max-time 20 "${API_URL}/health"; echo
code="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "${APP_URL}/")"
echo "app ${APP_URL} -> HTTP ${code}"
[[ "$code" == "200" ]]
