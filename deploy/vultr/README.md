# ArkPay on Vultr

Live demo (sslip.io, no custom domain):

- Web: https://app.139.84.249.48.sslip.io
- API: https://api.139.84.249.48.sslip.io
- Health: https://api.139.84.249.48.sslip.io/health

## Infrastructure

| Item | Value |
|---|---|
| Instance | `arkpay-prod` (`vhf-2c-4gb`, 2 vCPU / 4 GB / 128 GB NVMe) |
| Region | `jnb` (Johannesburg) |
| OS | Ubuntu 24.04 LTS (`os_id 2284`) |
| Public IP | `139.84.249.48` |
| Firewall | `arkpay-prod`: SSH from admin + workspace IPs; 80/443 public |
| Database | Postgres 16 container on the instance (`arkpay-pgdata` volume) |
| TLS | Caddy + Let's Encrypt for the two sslip.io hostnames |
| Backups | Vultr automatic backups enabled |

SSH (private key stays on the deployment workstation, never in git):

```bash
ssh -i ~/.ssh/arkpay_vultr root@139.84.249.48
```

## Deploy / update

From the repo root on the workstation:

```bash
tar czf /tmp/arkpay-deploy.tgz \
  --exclude='node_modules' --exclude='.git' --exclude='.local' \
  --exclude='.cache' --exclude='.config' --exclude='conversation-*.txt' \
  --exclude='.env' --exclude='.env.*' --exclude='apps/api/dist' --exclude='apps/web/.next' \
  apps scripts package.json pnpm-lock.yaml pnpm-workspace.yaml \
  docker-compose.prod.yml Caddyfile .dockerignore deploy/vultr/cloud-init.yaml

scp -i ~/.ssh/arkpay_vultr /tmp/arkpay-deploy.tgz root@139.84.249.48:/opt/arkpay/
scp -i ~/.ssh/arkpay_vultr deploy/vultr/.env.prod root@139.84.249.48:/opt/arkpay/.env
ssh -i ~/.ssh/arkpay_vultr root@139.84.249.48 \
  'cd /opt/arkpay && tar xzf arkpay-deploy.tgz && chmod 600 .env && docker compose -f docker-compose.prod.yml up -d --build'
```

Migrations run automatically on API container start (`prisma migrate deploy`).

If you change `/opt/arkpay/.env`, recreate the API container instead of
restarting it — `docker compose restart api` keeps the old environment:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate api
```

New variables (e.g. `WEB_APP_URL`) must reach the server too —
`deploy.sh` never ships `.env`, so copy it explicitly first:

```bash
scp -i ~/.ssh/arkpay_vultr deploy/vultr/.env.prod root@139.84.249.48:/opt/arkpay/.env
```

## First boot with an existing inbox

The first Gmail sync backfills the newest 50 messages. The pipeline would treat
that historical backlog as new work and may card old requests. On a fresh
deployment, drain the backlog once before the demo:

```sql
UPDATE "Email" SET status = 'IGNORED'
WHERE status = 'NEW' AND "receivedAt" < now() - interval '1 day';
```

The production instance was drained completely after the initial sync. New
mail arriving after deployment is processed normally.

## Production verification (Nov 3)

- `POST /pipeline/run` on a synthetic inbox email → Telegram card (Ada Obi /
  flyers / $450) → approval → PayPal `INV2-VWRJ-NCFU-DP99-PMKV` `SENT`.
- Direct `POST /telegram/demo-card` → approval → `INV2-GGHF-98PR-CTS5-CNBN`
  `SENT` (1.00 USD).
- Telegram webhook rejects requests without the secret header (401).

## Operations

```bash
cd /opt/arkpay
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml exec -T db psql -U arkpay -d arkpay
```

Health and pipeline checks:

```bash
curl https://api.139.84.249.48.sslip.io/health
curl https://api.139.84.249.48.sslip.io/ingest/status
curl https://api.139.84.249.48.sslip.io/pipeline/status
```

Telegram is in webhook mode; `main.ts` registers
`https://api.139.84.249.48.sslip.io/telegram/webhook` with the secret from
`TELEGRAM_WEBHOOK_SECRET`.

## Security notes

- Firewall allows SSH only from the admin IP and the deployment workspace IP.
- API, web, and Postgres ports are not published; only Caddy exposes 80/443.
- `/opt/arkpay/.env` is root-only (`0600`).
- Rotate the Vultr infrastructure and inference keys after the event.
- Postgres is a container: keep automatic backups enabled, and add a nightly
  `pg_dump` to Vultr Object Storage for an off-instance copy.
- sslip.io is fine for the hackathon demo; move to a real domain before a
  public launch.

## Redeploy from scratch

1. Create a Vultr Cloud Compute instance (Ubuntu 24.04, `jnb`).
2. Attach the firewall group and SSH key.
3. Run `deploy/vultr/cloud-init.yaml` (installs Docker).
4. Copy the code + `.env.prod` and run `docker compose up -d --build`.
5. Point the two sslip/real hostnames at the instance; Caddy handles TLS.
