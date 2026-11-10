# ArkPay

**ArkPay is the pocket finance office for freelancers getting paid:** a client emails asking for an invoice, you tap once on your phone, and the PayPal invoice is sent, chased when late, and defended if disputed — every step guarded by a safety engine with policy caps, risk checks, idempotency, and a full audit trail.

Get paid without the paperwork. Invoiced, chased, collected, and proven safe.

Built for the PayPal AI Hackathon. Deadline: **Nov 12, 2026**.

## Live demo

- Web: https://app.139.84.249.48.sslip.io
- API: https://api.139.84.249.48.sslip.io
- Health: https://api.139.84.249.48.sslip.io/health
- Deployment runbook: [deploy/vultr/README.md](deploy/vultr/README.md)

Deployed on Vultr Cloud Compute (`jnb`), Docker Compose, Postgres container,
Caddy TLS, and Vultr Serverless Inference. sslip.io is used for the demo because
there is no custom domain yet.

- Product + demo plan: [idea.md](idea.md)
- Architecture + flows + concurrency: [explain.md](explain.md)

## Judge demo (no sign-in)

Click **Explore the live demo** on the login page. You land in a shared
sandbox workspace with sample data — no Google account, no email connection
needed.

What you can do without connecting anything:

- **Approvals** — approve seeded invoice/payout drafts, then execute.
  Invoices execute **live** against the PayPal sandbox (you'll get a real
  `INV2-…` ref); payouts refuse honestly with `demo_readonly` so shared demo
  funds never move.
- **Audit** — trace any action end to end (created → approved → executed).
- **Safety** — policy rules, caps, and the seeded blocked fraud payout
  (`PAYEE_CHANGED` + urgency, no approve button).
- **Agent chat** (right-side bar) — balances, spend, pending queue, and
  "send invoice to …" drafts that land in Approvals. Runs on Muse Wonder.
- **Requests / Contacts / Schedules / Subscriptions / Disputes** — seeded rows to browse.
- **Voice + vision** — pair Telegram via the dashboard link code, then send a
  voice note (Muse Voice Transcribe) or receipt photo (Spark vision) to get a
  draft + approval card.

The only flow email unlocks is inbound Gmail → extraction → card; the demo
seeds already contain email-sourced requests, and the demo video shows the
live loop. Profile and connection editing is disabled in the shared demo.

## Layout

```
apps/api   NestJS 10 API: ingest, AI pipeline, Telegram bot, Safety Engine, PayPal execution, webhooks
apps/web   Vite SPA (TanStack Router): auth, onboarding, dashboard, safety + audit
```

## Quickstart

Prereqs: Node 20+, pnpm 9+, Docker.

```bash
# 1. Install
pnpm install

# 2. Env (single .env at repo root)
cp .env.example .env
# ... fill in your credentials ...

# 3. Database
pnpm db:up
pnpm db:migrate

# 4. Run
pnpm dev:api    # http://localhost:3001/health
pnpm dev:web    # http://localhost:3000
```

## Talk to the bot

The Telegram bot is an AI agent: it chooses tools, remembers the last 20
messages, and answers from real account/PayPal data. It can also send voice
notes, PDFs and text/CSV files into the same loop.

On Telegram you can send text, voice notes, PDFs, text/CSV files, photos or
image files, or use:

```text
/status        account state for this month
/spent         payouts this month
/balance       live PayPal wallet balance
/pending       open approvals
/emails Ada    search stored email
/invoice       create an invoice draft (then approve the card)
/schedules     list scheduled jobs and next runs
/payroll       prepare this month's STAFF payroll batch
/followup      remind a payer about an invoice
/statement     PDF statement for this month
/safety        Payment Safety Engine policy + limits
/blocked       recent Safety Engine blocks
/trace <id>    full audit trail for one action
/help          everything above
```

Natural language works too: “what have I spent this month?”, “send invoice to
ada@example.com for $450 for flyers”, “pay Sam $5 for a test”, “how did Q3
look?”, “give me a PDF statement for 2026-11”. Photos of receipts are read by
the vision model; scanned PDFs ask for photos instead.

## Notes

- NestJS is pinned to v10: `nestjs-telegraf`'s published peers cover Nest 9/10.
- PayPal credentials live server-side in `apps/api` only — they never enter LLM
  context (see `explain.md` §7b). The PayPal Agent Toolkit supplies **read-only**
  invoice/transaction/dispute tools to the agent. Its send/pay/refund/record
  tools are disabled, and money movement still goes through the approval →
  REST execution → audit path. Payouts and balances are not in the toolkit, so
  they go direct to REST.
- The AI layer sits behind an `LlmProvider` interface over an OpenAI-compatible
  chat-completions endpoint (`META_MODEL_*`, currently
  `deepseek/deepseek-v4.1-flash-1017`). Claude is not used.

## Payment Safety Engine

Every action passes a versioned policy at card creation and again inside the
execution transaction. A changed PayPal email on a payout, a cap breach, a
duplicate, an invalid currency or a failed approval check becomes `BLOCKED`:
no approve button, no PayPal call, and an audit entry. The demo case: a
“client” asking for a refund to a brand-new PayPal address gets stopped cold.

```bash
pnpm --filter @arkpay/api test:safety        # 25 pure-policy tests
pnpm --filter @arkpay/api test:safety:e2e    # real pipeline + Gate 2 fraud check
```

Read the trail via Telegram `/trace <actionId>` or the dashboard.

## Schedules

Schedules are rows, not hardcoded timers:

- `title` / `detail` are for humans.
- `kind` / `payload` tell the runner which handler to call.
- `trigger` is `ONCE`, `INTERVAL` or `CRON`, with a timezone.
- `ScheduleRun` records every occurrence with started/finished time, status,
  result or error.

Seeded jobs are **Monthly payroll prep** and **Invoice follow-up scan**. Add
another scheduled task with `POST /schedules`, pause/resume with
`PATCH /schedules/:id`, and run immediately with `POST /schedules/:id/run`.

```bash
pnpm --filter @arkpay/api test:scheduler
pnpm --filter @arkpay/api test:scheduler:e2e
pnpm --filter @arkpay/api test:payouts:mock   # state machine, PayPal stub
```

Payroll is prepared with `POST /payroll/prepare` or Telegram `/payroll`;
`PayrollRun.period` plus a Postgres advisory lock make it idempotent.

## Status

Day-by-day build plan in [idea.md](idea.md) §9. Phases 0–5, Phase 8 and Phase
8b are implemented and deployed on Vultr. Webhooks are verified for invoice
paid, duplicate replay, forged rejection and payout failure. Remaining: enable
sandbox Payouts and land one real single + batch `SUCCESS`, payroll STAFF demo
data, Phase 9 reminders/rules, demo recording, and Devpost submission.
