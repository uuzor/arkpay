# ArkPay Deployment Record

**Deployed:** Nov 3, 2026
**Target:** Vultr Cloud Compute (Johannesburg), Docker Compose, Postgres container, Caddy TLS
**Domain:** sslip.io (no custom domain yet)

## Live endpoints

| Service | URL |
|---|---|
| Web | https://app.139.84.249.48.sslip.io |
| API | https://api.139.84.249.48.sslip.io |
| Health | https://api.139.84.249.48.sslip.io/health |
| Telegram webhook | https://api.139.84.249.48.sslip.io/telegram/webhook |

Both hostnames have valid Let’s Encrypt certificates, issued automatically by Caddy.

## Architecture

```
Internet
  │
  ├── app.139.84.249.48.sslip.io ── Caddy ── Vite SPA :3000
  └── api.139.84.249.48.sslip.io ── Caddy ── NestJS API :3001
                                             │
                                   Postgres 16 :5432
                                   (Docker volume arkpay-pgdata)

Outbound:
  Gmail API · PayPal sandbox · Telegram Bot API · Vultr Serverless Inference
```

Only Caddy publishes ports (80/443). The API, web, and Postgres ports are
internal to the Compose network.

## Infrastructure

| Item | Value |
|---|---|
| Provider | Vultr |
| Instance | `arkpay-prod` (`vhf-2c-4gb`) |
| Spec | 2 vCPU / 4 GB RAM / 128 GB NVMe |
| Region | `jnb` (Johannesburg) |
| OS | Ubuntu 24.04 LTS (`os_id 2284`) |
| Public IPv4 | `139.84.249.48` |
| Instance ID | `3ae82add-919e-4302-8677-e9d7e354b5c0` |
| Firewall group | `arkpay-prod` (`cbd59b24-db56-46fd-818a-ac79c48362ce`) |
| Backups | Vultr automatic backups enabled |
| Cost | ~$24/mo instance + ~20% backups ≈ **$29/mo** |

## How it was built

### 1. Vultr account and API access

- Created an API key with provisioning, DNS, firewall, object storage,
  load-balancer, VKE, and registry ACLs.
- Added the deployment workspace egress IP (`35.197.47.11/32`) to
  **Account → API → Access Control**.
- Verified `GET https://api.vultr.com/v2/account` returns 200.

> **Workspace egress changes.** Replit hands workspaces different egress IPs.
> The current IP is printed by `deploy/ssh-bootstrap.sh` (today
> `136.70.15.135`). Add it to **Account → API → Access Control** and to the
> firewall's SSH rule before deploying from a fresh workspace. Both
> `api.vultr.com` and port 22 reject unknown IPs; there is no self-service
> bypass.

### 2. SSH key

Generated an Ed25519 keypair locally:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/arkpay_vultr -N '' -C 'arkpay-deploy'
```

Uploaded the public half through `POST /v2/ssh-keys` as `arkpay-deploy`.

The keypair lives **inside the workspace** at `.ssh/arkpay_vultr` (and is
copied to `~/.ssh/arkpay_vultr` for tools that expect the old path). `.ssh/`
is gitignored so the private key survives workspace resets without ever being
committed. Production is key-only: `PasswordAuthentication no`,
`PermitRootLogin prohibit-password`. `.env` stores `VULTR_SSH_KEY_PATH`, `VULTR_SSH_KEY_ID`, and the
public key.

If the workspace is recreated and the private key is gone, generate a new one
and register it:

```bash
ssh-keygen -t ed25519 -f .ssh/arkpay_vultr -N '' -C 'arkpay-deploy'
./deploy/ssh-bootstrap.sh        # registers the key + opens SSH for this IP
```

`POST /v2/ssh-keys` only stores the key on the Vultr account; it is injected
into **new** instances at build time. To trust a new key on the running
instance, paste the command printed by the script into the Vultr web console
(**View Console**) once:

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh
echo '<public key>' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

Root SSH is key-only (`PasswordAuthentication no`,
`PermitRootLogin prohibit-password`).

### 3. Firewall

Created the firewall group with `POST /v2/firewalls`, then added rules through
`POST /v2/firewalls/{id}/rules` (creating a group does **not** create its
rules in one call):

| Direction | Protocol | Port | Source |
|---|---|---|---|
| in | tcp | 22 | `102.90.80.200/32` (admin) |
| in | tcp | 22 | `35.197.47.11/32` (old deployment workspace) |
| in | tcp | 22 | current workspace egress, e.g. `136.70.15.135/32` |
| in | tcp | 80 | `0.0.0.0/0` |
| in | tcp | 443 | `0.0.0.0/0` |

`deploy/ssh-bootstrap.sh` adds the current `/32` rule idempotently once the
API key can be used from this IP.

### 4. Instance + Docker

Created the instance with:

```json
{
  "region": "jnb",
  "plan": "vhf-2c-4gb",
  "os_id": 2284,
  "label": "arkpay-prod",
  "hostname": "arkpay",
  "sshkey_id": ["<key-id>"],
  "firewall_group_id": "<firewall-id>",
  "backups": "enabled",
  "user_data": "<base64 cloud-init>"
}
```

`deploy/vultr/cloud-init.yaml` installs Docker and creates `/opt/arkpay`.

> **Field note:** the instance API expects `sshkey_id` (array). The template
> API uses `ssh_key_ids`; using the template field on an instance silently
> leaves SSH unconfigured. This cost one instance rebuild.

### 5. Application packaging

Added:

- `apps/api/Dockerfile` — Node 20 + pnpm, Prisma generate/build, runs
  `prisma migrate deploy` then `node dist/main.js`.
- `apps/web/Dockerfile` — Vite build + nginx static server; `/api/*` is reverse-proxied to the API by Caddy.
- `docker-compose.prod.yml` — `db`, `api`, `web`, `caddy`.
- `Caddyfile` — two sslip.io hostnames, automatic TLS.
- `.dockerignore`.

The code was packaged without secrets or build artefacts:

```bash
tar czf /tmp/arkpay-deploy.tgz \
  --exclude='node_modules' --exclude='.git' --exclude='.local' \
  --exclude='.cache' --exclude='.config' --exclude='conversation-*.txt' \
  --exclude='.env' --exclude='.env.*' --exclude='apps/api/dist' --exclude='apps/web/dist' \
  apps scripts package.json pnpm-lock.yaml pnpm-workspace.yaml \
  docker-compose.prod.yml Caddyfile .dockerignore deploy/vultr/cloud-init.yaml
```

Uploaded with `scp` to `/opt/arkpay`, plus a production `.env` (`0600`).

### 6. Production environment

`deploy/vultr/.env.prod` is generated from the local `.env` with these
overrides:

```env
NODE_ENV=production
API_PORT=3001
API_PUBLIC_URL=https://api.139.84.249.48.sslip.io
APP_HOST=app.139.84.249.48.sslip.io
API_HOST=api.139.84.249.48.sslip.io
POSTGRES_USER=arkpay
POSTGRES_PASSWORD=<random>
POSTGRES_DB=arkpay
DATABASE_URL=postgresql://arkpay:<random>@db:5432/arkpay?schema=public
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=<random>
GMAIL_REDIRECT_URI=https://api.139.84.249.48.sslip.io/auth/gmail/callback
SESSION_SECRET=<random>
```

The infrastructure Vultr key is **not** copied to the server. Only the app’s
runtime secrets and the Vultr inference key are present.

### 7. Build and start

```bash
cd /opt/arkpay
docker compose -f docker-compose.prod.yml up -d --build
```

The API container runs `prisma migrate deploy` before starting. Caddy obtained
certificates via ACME; `main.ts` registered the Telegram webhook automatically.

## Production verification

| Check | Result |
|---|---|
| `GET /health` | `{"ok":true,"service":"arkpay-api"}` |
| Web | HTTP 200 |
| Containers | api + db healthy; web + caddy up |
| Gmail ingest | 50 messages, history poller running |
| Telegram webhook | set; `pending_update_count: 0`; no last error |
| Missing webhook secret | HTTP 401 |
| Pipeline email → card | synthetic inbox email → card (`Ada Obi`, flyers, $450) |
| Approval → invoice | `INV2-VWRJ-NCFU-DP99-PMKV` → `SENT`, 450.00 USD |
| Direct card check | `INV2-GGHF-98PR-CTS5-CNBN` → `SENT`, 1.00 USD |
| DB after approval | action `EXECUTED`, `paypalRef` stored |
| Manual follow-up | `REMINDER_SENT` audit for `INV2-VWRJ-NCFU-DP99-PMKV` |
| Telegram text | account-state and PDF-statement replies delivered |
| Telegram voice | voice note transcribed and answered |
| Telegram document | PDF read and answered |
| Historical backlog | drained to `IGNORED` so only new mail cards |

## Issues encountered

1. **Vultr API 401 `Unauthorized IP address`** — the key was IP-restricted.
   Fixed by adding `35.197.47.11/32` in API Access Control.
2. **`vc2-2c-4gb` not available in `jnb`** — switched to `vhf-2c-4gb`
   (High Frequency, 2 vCPU / 4 GB / 128 GB NVMe).
3. **Instance had no SSH key** — used `ssh_key_ids` instead of the instance
   field `sshkey_id`; destroyed and recreated before deploying anything.
4. **SSH timeout after boot** — cloud-init was still running; port 22 opened
   about a minute later.
5. **Firewall group had no rules** — the create-group call ignored the embedded
   `rules`; rules must be posted to `/firewalls/{id}/rules`.
6. **Historical inbox backfill** — the first full sync treats the newest 50
   emails as new work. Drained the backlog to `IGNORED` before the demo; new
   mail is processed normally.
7. **AI SDK/provider mismatch** — `@ai-sdk/openai-compatible@2` implements a
   newer provider spec than `ai@5`; it failed with “Unsupported model version
   v3”. Pinned the provider to `1.0.61` (provider spec v2).
8. **Toolkit type explosion** — a static import of `@paypal/agent-toolkit`
   pulled in AI SDK 4, LangChain and OpenAI types and OOM’d `nest build`.
   Switched to a lazy runtime `require` and capped the Docker build heap.
9. **PayPal balance 403 (resolved)** — the sandbox REST app initially had
   invoicing/payments scopes but not Reporting/Transaction Search, so
   `/v1/reporting/balances` and `/v1/reporting/transactions` returned 403.
   Enabled **Transaction Search** in the sandbox app settings; the next token
   carried `https://uri.paypal.com/services/reporting/search/read` and both
   endpoints returned 200 after an API restart. Balance reads are live.

## Operations

```bash
ssh -i ~/.ssh/arkpay_vultr root@139.84.249.48

cd /opt/arkpay
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml exec -T db psql -U arkpay -d arkpay
```

Health/pipeline:

```bash
curl https://api.139.84.249.48.sslip.io/health
curl https://api.139.84.249.48.sslip.io/ingest/status
curl https://api.139.84.249.48.sslip.io/pipeline/status
```

Backups: Vultr automatic backups are enabled. Before relying on this beyond the
demo, add a nightly `pg_dump` to Vultr Object Storage and test a restore.

## Security notes

- `.env` is gitignored; the production copy is `0600` and contains no
  infrastructure API key.
- Root SSH is key-only; the firewall restricts SSH to two known IPs.
- API, web, and Postgres ports are not published.
- Rotate both Vultr keys after the event (they were pasted into chat).
- Move from sslip.io to a real domain before public launch.
- This deployment does **not** qualify for the Best Use of Render prize; a
  parallel Render deployment is still needed if that prize is targeted.

## AI agent loop + tools (deployed Nov 3, 7:19 PM UTC)

The Telegram bot is now a real tool-using agent, not a regex router.

```
text / voice transcript / document text
        │
        ▼
AgentService  (Vercel AI SDK 5 + Vultr/DeepSeek tool calling)
  system prompt, last 20 messages from AgentMessage
        │
        ├── get_paypal_balance
        ├── get_account_summary
        ├── get_spend
        ├── list_pending
        ├── search_emails
        ├── lookup_contact
        ├── create_invoice_draft   → PENDING action + approval card
        ├── follow_up_invoice      → PayPal remind + audit
        ├── generate_statement     → PDF side-channel
        ├── paypal_list_invoices   ┐
        ├── paypal_get_invoice     │ PayPal Agent Toolkit
        ├── paypal_search_invoicing│ read-only subset
        ├── paypal_list_transactions
        ├── paypal_list_disputes
        └── paypal_get_dispute
        │
        ▼
LLM composes the final reply from tool results
```

Design rules:

- **Model:** `deepseek-v4.1-flash-1017` via Vultr Serverless Inference. Tool
  calling was verified with a raw `tool_calls` response before wiring it.
- **Memory:** new `AgentMessage` migration `20261103190612_agent_memory`;
  last 20 user/assistant messages per Telegram user. `/reset` clears them.
- **Money safety:** `create_invoice_draft` only creates a `PENDING_APPROVAL`
  action and Telegram card. It never calls PayPal. The existing approval →
  execution service sends the invoice after a tap and audits every hop.
- **PayPal toolkit:** `@paypal/agent-toolkit` supplies read-only invoice,
  transaction and dispute tools. The dangerous tools (`send_invoice`,
  `pay_order`, `create_refund`, `record_payment`, `record_refund`,
  dispute accept, subscriptions, orders) are **disabled by configuration**.
  The toolkit has no payouts and no balance tools.
- **Balance:** `get_paypal_balance` calls `/v1/reporting/balances` and returns
  the real wallet balance and withheld amount. The sandbox app now has
  Transaction Search (`reporting/search/read`), which also authorizes the
  balances endpoint. If the scope is ever missing, the agent reports the 403
  honestly instead of substituting invoice totals.
- **Voice:** Telegram OGG → Vultr `whisper-large-v3-turbo` → agent text.
- **Files:** PDF (`pdf-parse` v2), text, CSV, JSON, audio and images → agent text.
- **Vision:** `VISION_MODEL_NAME` (verified: `mimo-v2.6-flash`) describes
  receipts/invoices/screenshots. Scanned PDFs (<50 extracted chars) ask for
  photos; video is still unsupported.
- **Agent money-out:** `request_payout` creates a `PENDING_APPROVAL`
  `PAYOUT_SINGLE` through Gate 1 and the normal card; refunds use the same
  payout path with a `Refund: …` purpose. Gate 2 re-checks on execution.
- **Transaction search:** `search_paypal_transactions` splits any range into
  ≤31-day PayPal windows, pages them, merges rows and returns per-currency
  totals (`PaypalTransactionsService`). Verified 2 windows / 1 row / USD
  5,000.00 for Oct 1–Nov 3 and 3 windows / 0 rows for Q3.
- **Statements:** PDF generated with `pdfkit`, attached to the agent reply.
- **Follow-ups:** every 6h, checks executed invoices, skips paid/cancelled,
  reminds at 3/7/14 days, audits each stage.
- **Commands** are shortcuts into the same tool paths: `/help`, `/status`,
  `/balance`, `/spent`, `/pending`, `/emails`, `/invoice`, `/schedules`,
  `/payroll`, `/followup`, `/statement`, `/safety`, `/blocked`, `/trace`, `/reset`,
  `/cancel`, `/whoami`.

Environment additions:

```env
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_MS=30000
SCHEDULER_SEED_DEFAULTS=true
FOLLOWUP_ENABLED=true
FOLLOWUP_CRON=0 */6 * * *
FOLLOWUP_DAYS=3,7,14
PAYROLL_ENABLED=true
PAYROLL_CRON=0 9 1 * *
PAYROLL_TIMEZONE=UTC
TRANSCRIBE_MODEL=whisper-large-v3-turbo   # optional; this is the default
VISION_MODEL_NAME=mimo-v2.6-flash          # verified vision-capable model
```

Production verification (live):

- “Hello” → natural greeting, no tool.
- “What is my PayPal balance?” → `get_paypal_balance` → **$5,000.00 USD**
  available, $0.00 withheld.
- “Show my recent PayPal transactions” → `paypal_list_transactions` → one
  $5,000.00 USD transaction.
- “What is my account state this month?” → `get_account_summary`.
- “What did I spend this month?” → `get_spend`.
- “Show emails from Intel” → `search_emails`.
- “List my PayPal invoices” → `paypal_list_invoices` (9 invoices).
- “Status of INV2-XWT9-K46B-98XA-XHRT?” → `paypal_get_invoice` → SENT.
- “Send invoice to Deploy Test (deploy-test@example.com) for $5 …” →
  `create_invoice_draft` → card → approval → `INV2-XWT9-K46B-98XA-XHRT`
  executed.
- “What did I just ask you to do?” → remembered the invoice instruction.
- PDF statement generated and sent; PDF upload read and summarized; voice note
  transcribed and answered; unsupported message gets a fallback reply.
- Follow-up scheduler started with executed invoices checked and 0 due.

Build notes:

- `ai@5` + `@ai-sdk/openai-compatible@1.0.61` (the 2.x provider line implements
  the newer provider spec and fails with “Unsupported model version v3”).
- The PayPal toolkit’s static types pull in its full AI SDK 4/LangChain/OpenAI
  graph and OOM the Nest compiler. It is loaded via a runtime `require`, and
  the Docker build caps the compiler at 3 GB.

## Payment Safety Engine + fraud demo (Phase 8, Nov 3)

Policy version: `arkpay-policy-2026-11-03`. The same pure evaluator runs at two
gates:

- **Gate 1 — creation:** email pipeline, AI-agent invoice draft, team batch,
  demo card and supersede/edit. `BLOCK` persists the action as `BLOCKED`,
  writes `SAFETY_EVALUATED` + `BLOCKED` audit rows, and sends a Telegram notice
  with the reason and **no approve button**.
- **Gate 2 — execution:** inside the single/batch `APPROVED → EXECUTING`
  transaction, after hash/version verification and before any PayPal call. A
  changed payee, new duplicate or consumed cap refuses and marks the row
  `BLOCKED`.

Checks: currency allow-list, email/amount/due-date validity, invoice maximum,
per-vendor and global daily caps, batch size/total caps, duplicate detection,
payee-change detection, amount anomaly, injection/urgency signals, new-payee
confirmation, and approval expiry/hash/version/approver identity.

Persistence and visibility:

- Migration `20261103203000_safety_policy` adds `Action.policyVersion`,
  `policyVerdict`, `safetySummary`; `riskFlags` holds the flags.
- `GET /safety/policy`, `GET /safety/blocked`, `POST /safety/evaluate`.
- `GET /audit/recent`, `GET /audit/actions/:id`.
- Telegram `/safety`, `/blocked`, `/trace <actionId>`.
- Dashboard (`apps/web`) shows the policy, blocked actions with source email,
  and the audit event list. The web container gets `API_BASE_URL=http://api:3001`.

Fraud verification (local, real pipeline):

- Known contact `Acme Fraud Demo` (`old-…@acme-fraud.test`, 5 payments, usual
  $100) receives “our PayPal email changed… pay 100.00 USD to
  `new-…@attacker.test`… urgent”.
- LLM extracted `PAYMENT_REQUEST`; Gate 1 produced flags
  `PAYEE_CHANGED,URGENCY`, status `BLOCKED`; the contact record stayed on the
  old email; Telegram captured “Blocked by the Payment Safety Engine… No money
  moved”.
- The same action forced to `APPROVED` and sent through
  `executeApprovedAction()` returned `reason=blocked`, wrote a Gate 2
  `BLOCKED` audit row, and made no PayPal call.
- `pnpm --filter @arkpay/api test:safety` → **25/25**;
  `pnpm --filter @arkpay/api test:safety:e2e` → passes.

Safety env defaults (all optional; code defaults shown):

```env
SAFETY_CURRENCY_ALLOWLIST=USD,EUR,GBP,NGN,CAD,AUD
INVOICE_MAX_AMOUNT=10000
BATCH_MAX_ITEMS=20
BATCH_MAX_TOTAL=5000
DUPLICATE_WINDOW_HOURS=24
AMOUNT_ANOMALY_FACTOR=2
DUE_DATE_MAX_DAYS=365
AUTO_APPROVE_MAX_AMOUNT=0
VENDOR_DAILY_CAP=500
GLOBAL_DAILY_CAP=2000
```

## Generic schedule engine (Phase 8b, deployed Nov 3 9:59 PM UTC)

Schedules are rows, not hardcoded timers. Migration
`20261103210000_generic_scheduler` adds:

- `Schedule`: `title`, `detail`, `kind`, `payload`, `trigger`
  (`ONCE`/`INTERVAL`/`CRON`), `timezone`, `nextRunAt`, status, misfire policy,
  `systemKey` for seeded rows.
- `ScheduleRun`: one row per occurrence with `scheduledFor`, `startedAt`,
  `finishedAt`, status, `trigger`, `result` and `error`.
- `PayrollRun` lifecycle fields: `preparedAt`, `preparedBy`, `note`,
  `skippedReason`, `updatedAt`.

Runner:

- `SchedulerService` starts from `main.ts`, ticks every 30s, finds ACTIVE
  schedules whose `nextRunAt` is due, creates one unique `ScheduleRun` for the
  occurrence, dispatches by `kind`, and advances `nextRunAt`.
- `@@unique([scheduleId, scheduledFor])` prevents two ticks/processes from
  running one occurrence twice. `advanceAfterRun` skips a backlog instead of
  replaying every missed month.
- Unknown `kind` fails the run and pauses the schedule.
- Seeded once: **Monthly payroll prep** (`PAYROLL_PREPARE`, `0 9 1 * *`,
  configurable timezone) and **Invoice follow-up scan**
  (`INVOICE_REMINDERS`, `0 */6 * * *`). The old follow-up `setInterval` was
  removed; the scheduler is now the only business timer.
- Handlers: `PAYROLL_PREPARE`, `INVOICE_REMINDERS`, `NOTIFY`, `AGENT_TASK`
  (agent runs with invoice/payout/reminder tools removed), `NOOP`.

Payroll:

- `PayrollService.prepare(period)` acquires
  `pg_advisory_xact_lock('arkpay:payroll:<period>')`, reuses an existing
  `PayrollRun` if present, otherwise assembles the team batch and writes
  `PayrollRun` + actions in one transaction.
- The schedule only decides **when**; `PayrollRun.period @unique` is the domain
  idempotency guard.
- Endpoints: `GET /payroll`, `GET /payroll/:period`,
  `POST /payroll/prepare`, `POST /payroll/:period/resend-card`.
- Telegram `/payroll [YYYY-MM]` prepares and sends the batch card.

Schedule endpoints: `GET /schedules`, `GET /schedules/:id`,
`GET /schedules/:id/runs`, `POST /schedules`,
`PATCH /schedules/:id`, `POST /schedules/:id/run`.
The dashboard now shows schedules (title/detail/kind/status/next/last run) and
payroll runs.

Verified in production:

- Migration `20261103210000_generic_scheduler` applied on API start.
- Seeded **Monthly payroll prep** (next `2026-12-01T09:00:00Z`) and
  **Invoice follow-up scan** (next `2026-11-04T00:00:00Z`).
- `GET /schedules`, `GET /payroll`, `/safety/policy` and the dashboard all
  return 200; dashboard shows both schedules and the payroll section.
- Telegram “List my scheduled jobs” called `list_schedules` and answered with
  both active schedules.
- Telegram “How did October 2026 look?” called `search_paypal_transactions`
  and answered from PayPal data.
- Vision verified inside the API container with `mimo-v2.6-flash`.

Also verified locally: `test:scheduler` 5/5, `test:scheduler:e2e`, two
concurrent `PayrollService.prepare()` calls (one run/batch).

## Webhook production fix (Nov 3)

The PayPal webhook had been left pointing at the old Replit host and
`PAYPAL_WEBHOOK_ID` was blank in `/opt/arkpay/.env`, so every real event
returned 500. Fixed:

- PATCHed webhook `9YG02413MS108163P` to
  `https://api.139.84.249.48.sslip.io/paypal/webhook`.
- Set `PAYPAL_WEBHOOK_ID=9YG02413MS108163P` and force-recreated the API
  (a plain `restart` keeps the old container env).
- Real PAID event → `WEBHOOK_PAID` + contact learning; replay → no new audit.
- Forged event → 401; payout `J6TC65WBQVPEC` DENIED → `FAILED` with
  `EXECUTION_FAILED`/`WEBHOOK_PAYOUT_DENIED`; replay → no extra audit.
- Agent notification `DataCloneError` from Prisma `Decimal` values fixed by
  returning strings from `get_audit_trail`, `list_blocked_actions` and
  `lookup_contact`.

Payout idempotency correction: PayPal accepted two batches with the same
`sender_batch_id`; ArkPay now fails closed on stale no-ref payouts
(`PAYOUT_UNKNOWN`, no requeue) and refuses `FAILED` payout retries.

## What is still missing

- Real single + batch payout `SUCCESS` (Phase 6 state machine is verified with
  `test:payouts:mock`; live attempts are `DENIED` because the sandbox business
  account is not Payouts-enabled). This blocks end-to-end payroll execution and
  the agent payout path. Enable Payouts on the sandbox business account, then
  re-run one $1 single and a two-person batch.
- PayPal webhook loop is verified for invoice PAID, duplicate replay, forged
  rejection, payout failure and agent notification. The production webhook URL
  was moved from the old Replit host to
  `https://api.139.84.249.48.sslip.io/paypal/webhook` and
  `PAYPAL_WEBHOOK_ID=9YG02413MS108163P` is set; the API must be force-recreated
  (not just restarted) after env changes. Payout `SUCCESS` event still waits on
  the Phase 6 account gate.
- Production payroll demo data: there are currently no `STAFF` contacts, so
  the active monthly payroll schedule would have nothing to prepare. Add at
  least one STAFF contact with a PayPal email and `usualAmount`.
- Phase 9 leftovers: due-date-aware late-payer reminder drafts, auto-approve
  rules/UI (still off), rules and reminder views on the dashboard.
- Video understanding and voice replies (TTS); image understanding is verified.
- Demo recording and Devpost submission; optional Render deployment for the
  Render prize.
- Operational hardening: user routes are session-guarded since 10d, but Postgres
  is a single container without off-instance dumps, and sslip.io is a demo
  hostname.


### Recovering SSH without the private key

Vultr cannot inject a key into a running instance. The recovery used on
2026-11-04:

1. `PATCH /v2/ssh-keys/<instance-key-id>` with the new public key.
2. `POST /v2/snapshots` for the instance; create a clone from that snapshot
   with `sshkey_id: [<instance-key-id>]`.
3. SSH into the clone (it has the new key and all data), stop containers.
4. `POST /v2/snapshots` for the clone, then `POST /v2/instances/<original>/restore`
   with that snapshot. The original keeps its IP and comes back with the key.
5. Delete the clone and its snapshot; keep the pre-change snapshot until the
   deploy is verified.

### Session cookie across app/api hosts

The OAuth callback lands on `api.<host>` while the SPA is served from
`app.<host>`. Without a parent-domain cookie the SPA never sees the session.
Set:

```bash
WEB_APP_URL=https://app.<host>
SESSION_COOKIE_DOMAIN=<host>
```

### Docker build context

`COPY` merges; files deleted from the repo survive in old layers and in a
server-side `/opt/arkpay` tree. `deploy/deploy.sh` removes `apps/` before
extracting, and both Dockerfiles clear `src/` before copying, so renamed or
deleted services cannot be compiled again.
