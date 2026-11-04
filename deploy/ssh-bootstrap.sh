#!/usr/bin/env bash
# Prepare SSH access from a fresh workspace.
#
# 1. Registers .ssh/arkpay_vultr.pub with the Vultr account (idempotent).
# 2. Allows the current egress IP to reach port 22 on the arkpay-prod firewall.
# 3. Prints the one-time console command for the running instance.
#
# Vultr has no API to inject an SSH key into an existing instance: `POST
# /v2/ssh-keys` only stores it on the account, so it is used at the next
# instance build. The running server must trust the new key once through the
# Vultr web console (View Console → paste the printed command).
#
# Requires:
#   - VULTR_API_KEY with ssh-key + firewall scope
#   - this workspace's egress IP allowlisted in Account → API → Access Control
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "missing .env" >&2
  exit 1
fi

# Read single-line KEY=VALUE pairs without shell-sourcing .env: the public
# key value contains spaces and would otherwise be word-split.
env_get() {
  grep -m1 "^$1=" .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

VULTR_API_KEY="$(env_get VULTR_API_KEY)"
VULTR_FIREWALL_ID="$(env_get VULTR_FIREWALL_ID)"
VULTR_INSTANCE_ID="$(env_get VULTR_INSTANCE_ID)"
VULTR_INSTANCE_IP="$(env_get VULTR_INSTANCE_IP)"
VULTR_SSH_KEY_ID="$(env_get VULTR_SSH_KEY_ID)"
VULTR_SSH_KEY_PATH="$(env_get VULTR_SSH_KEY_PATH)"

: "${VULTR_API_KEY:?VULTR_API_KEY is required}"
: "${VULTR_FIREWALL_ID:?VULTR_FIREWALL_ID is required}"
PUB_KEY_FILE="${VULTR_SSH_KEY_PATH:-$PWD/.ssh/arkpay_vultr}.pub"
: "${PUB_KEY_FILE:?}"

[[ -f "$PUB_KEY_FILE" ]] || { echo "missing $PUB_KEY_FILE" >&2; exit 1; }

api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "https://api.vultr.com/v2${path}" \
      -H "Authorization: Bearer ${VULTR_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -fsS -X "$method" "https://api.vultr.com/v2${path}" \
      -H "Authorization: Bearer ${VULTR_API_KEY}"
  fi
}

IP="$(curl -fsS https://api.ipify.org)"
echo "workspace egress IP: ${IP}"

# 1. Account-level SSH key
if [[ -n "${VULTR_SSH_KEY_ID:-}" ]]; then
  echo "SSH key already registered: ${VULTR_SSH_KEY_ID}"
else
  KEY_JSON="$(jq -Rn --rawfile k "$PUB_KEY_FILE" \
    '{name:"arkpay-deploy", ssh_key:($k|rtrimstr("\n"))}')"
  KEY_ID="$(api POST /ssh-keys "$KEY_JSON" | jq -r '.ssh_key.id')"
  echo "registered SSH key: ${KEY_ID}"
  echo "set VULTR_SSH_KEY_ID=${KEY_ID} in .env"
fi

# 2. Firewall: allow the current egress IP on 22 if it is not already there.
SUB="${IP}/32"
RULES="$(api GET "/firewalls/${VULTR_FIREWALL_ID}/rules?per_page=100")"
if jq -e --arg ip "$IP" \
  '.firewall_rules[] | select(.protocol=="tcp" and (.port|tostring)=="22" and .subnet==$ip and (.subnet_size==32) and .ip_type=="v4")' \
  >/dev/null <<<"$RULES"; then
  echo "firewall already allows ${SUB} on tcp/22"
else
  api POST "/firewalls/${VULTR_FIREWALL_ID}/rules" \
    "{\"ip_type\":\"v4\",\"protocol\":\"tcp\",\"subnet\":\"${SUB}\",\"subnet_size\":32,\"port\":\"22\"}" \
    >/dev/null
  echo "added firewall rule: tcp/22 from ${SUB}"
fi

cat <<EOF

Next (one time, in the Vultr web console for instance ${VULTR_INSTANCE_ID}):
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  echo '$(cat "$PUB_KEY_FILE")' >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys

Then deploy:
  ssh -i ${VULTR_SSH_KEY_PATH:-$PWD/.ssh/arkpay_vultr} root@${VULTR_INSTANCE_IP:-139.84.249.48}
EOF
