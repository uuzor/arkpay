# ArkPay — Architecture & Flow

How the system is put together, how each money loop runs end to end, and how
concurrency, safety, and failure handling work. This is the build reference:
code should follow this doc, and this doc gets updated when reality disagrees.

Companion: [idea.md](idea.md) (product, demo script, build plan).

---

## 1. Principles

1. **Postgres is the source of truth.** Every email, decision, approval,
   PayPal call, and webhook event is a row before it is an action.
   If the process restarts mid-flow, the database tells us exactly where to resume.
2. **The model proposes, code disposes.** The LLM only fills a fixed JSON schema
   (payee, amount, currency, purpose, due date, risk signals). It has no tools,
   no PayPal access, and never sees credentials. Deterministic code validates
   the JSON and builds the action.
3. **One approval = one exact action.** An approval locks a hash of
   (payee, amount, currency, purpose, idempotency key). Anything edited becomes
   a new action needing a fresh approval.
4. **Single-writer execution.** Only the execution service moves money, and any
   given action executes at most once, enforced by the database, not by hope.
5. **Start boring, scale later.** One NestJS API deployment + Postgres (+ Prisma)
   + one Next.js dashboard. No queue, no Redis, no microservices for the MVP.
   Concurrency control lives in Postgres (unique constraints, advisory locks,
   state machines). Add a job queue only if polling/webhooks outgrow one process.

---

## 2. System map

```
                        +------------------+
                        |  Gmail API       |
                        |  (poll every ~60s|
                        |   + historyId)   |
                        +--------+---------+
                                 |
                                 v
+-----------+   +-----------------------------+   +------------------+
| Telegram  |<->|  apps/api (NestJS 10)       |->|  PayPal sandbox  |
| Bot API   |   |                             |   |  - Invoicing   |
| (approve/ |   |  Ingest worker              |   |    (agent-     |
|  edit/    |   |  AI pipeline (LlmProvider)  |   |     toolkit fns|
|  ignore,  |   |  Contacts book              |   |     via code)  |
|  "pay my  |   |  Decision service           |<--|  - Payouts     |
|  team")   |   |  Safety Engine (checks)     |   |    (REST direct|
+-----------+   |  Execution service (money)  |   |     single+batch|
                |  Webhook handler (PayPal)   |   |  - Webhooks    |
                |  Schedulers (payroll,       |   +--------+-------+
                |   reminders)                |            |
                +-------------+---------------+            |
                              |                          |
                     +--------v--------+        +--------v---------+
                     | Postgres 16     |        | apps/web (Next.js)|
                     | (Prisma)        |------->| Dashboard: feed, |
                     | emails, actions,|  read  | audit log, rules |
                     | contacts, audit |        +------------------+
                     +-----------------+
```

### Components (all inside `apps/api` unless noted)

| Component | Responsibility | Touches money? |
|---|---|---|
| Ingest worker | Poll Gmail, store raw emails, dedupe by Gmail `messageId` | No |
| AI pipeline | Classify + extract to strict JSON via `LlmProvider` interface; flags risk signals | No |
| Contacts book | Match/save payees (name, PayPal email/ID, history, usual amounts) | No |
| Decision service | Create action records in `PENDING_APPROVAL`, render Telegram cards | No |
| Telegram bot (`nestjs-telegraf`) | Deliver cards, collect Approve/Edit/Ignore, accept "pay my team" | No (signals only) |
| Safety Engine | Pure checks run before card creation AND before execution: caps, duplicates, payee-change, anomaly, injection flags | No (gate only) |
| Execution service | Owns PayPal credentials; the ONLY caller of Invoicing/Payouts APIs | **Yes — only writer** |
| Webhook handler | Verify PayPal signature, dedupe by event ID, update action status, notify Telegram | No |
| Schedulers | Monthly payroll prep, late-payer reminders, auto-approve evaluation | No (prepare only; execution still needs approval) |
| Dashboard (`apps/web`) | Read-only-ish view: activity feed, audit log, rules config | No |

### Stack choices (locked per review)

- **Monorepo:** pnpm workspace, `apps/api` from `nest new` (NestJS **10** —
  matches `nestjs-telegraf` peer deps), `apps/web` from `create-next-app`.
- **DB:** Postgres 16 (Docker locally and on the Vultr instance; managed
  Postgres is the upgrade path), Prisma ORM.
- **Telegram:** `nestjs-telegraf`, webhook mode in production (long polling
  locally).
- **PayPal:** `agent-toolkit` invoice functions called from execution-service
  code only (never exposed to the model); Payouts via direct REST calls.
- **AI:** `LlmProvider` interface over an OpenAI-compatible chat-completions
  endpoint (`META_MODEL_*`, currently `deepseek/deepseek-v4.1-flash-1017`).
- **Licence:** MIT at repo root (hackathon open-source requirement).

---

## 3. Data model (first Prisma schema)

```prisma
model Email {
  id         String      @id @default(cuid())
  gmailId    String      @unique          // dedupe: same Gmail message never ingested twice
  threadId   String?
  from       String
  subject    String?
  body       String                   // raw, untrusted
  status     EmailStatus @default(NEW) // NEW | PROCESSED | NEEDS_REVIEW | IGNORED
  receivedAt DateTime
  createdAt  DateTime @default(now())
  actions    Action[]
}

model Contact {
  id          String   @id @default(cuid())
  name        String
  paypalEmail String?                // store PayPal email/ID, never raw bank details
  kind        ContactKind            // CLIENT | SUPPLIER | STAFF
  usualAmount Decimal?
  currency    String   @default("USD")
  firstSeenAt DateTime @default(now())
  lastPaidAt  DateTime?
  payCount    Int      @default(0)
  actions     Action[]

  @@unique([name, kind])
  @@index([paypalEmail])
}

model Action {
  id             String       @id @default(cuid())
  type           ActionType   // INVOICE | PAYOUT_SINGLE | PAYOUT_BATCH
  status         ActionStatus @default(PENDING_APPROVAL)
  emailId        String?
  email          Email?       @relation(fields: [emailId], references: [id])
  contactId      String?
  contact        Contact?     @relation(fields: [contactId], references: [id])
  payeeName      String
  payeePaypal    String
  amount         Decimal
  currency       String
  purpose        String
  dueDate        DateTime?
  extractedJson  Json         // what the model proposed
  riskFlags      String[]     // DUPLICATE, PAYEE_CHANGED, AMOUNT_ANOMALY, INJECTION_SIGNAL, NEW_PAYEE, URGENCY ...
  confidence     Float?
  actionHash     String       // sha256(payee|amount|currency|purpose|idempotencyKey)
  idempotencyKey String       @unique  // one key per action; PayPal calls carry it
  batchId        String?               // groups PAYOUT_BATCH members
  paypalRef      String?               // invoice ID / payout batch ID once executed
  approvedBy     String?               // Telegram user id
  approvedAt     DateTime?
  expiresAt      DateTime               // approvals die young (~15 min for pay, longer for invoice)
  version        Int          @default(1) // optimistic lock; edits bump version + new hash
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  audit          AuditLog[]

  @@index([status])
  @@index([batchId])
}

model AuditLog {
  id        String   @id @default(cuid())
  actionId  String
  action    Action   @relation(fields: [actionId], references: [id])
  event     String   // CREATED | CARD_SENT | APPROVED | EDITED | BLOCKED | EXECUTED | WEBHOOK_* | ...
  detail    Json?
  createdAt DateTime @default(now())

  @@index([actionId])
}

model ProcessedWebhook {
  eventId   String   @id              // PayPal webhook event id; insert-or-ignore dedupes
  type      String
  createdAt DateTime @default(now())
}

model PayrollRun {
  id          String       @id @default(cuid())
  period      String       @unique   // "2026-11" — unique prevents double-preparing a month
  status      ActionStatus @default(PENDING_APPROVAL)
  batchId     String       @unique
  totalAmount Decimal
  currency    String
  createdAt   DateTime     @default(now())
}
```

State machine for `Action.status`:

```
PENDING_APPROVAL --> APPROVED --> EXECUTING --> EXECUTED
       |                |             |
       |                v             v
       +----------> BLOCKED      FAILED (retryable) --> EXECUTING
       |
       +--> IGNORED / EXPIRED / SUPERSEDED (terminal)
```

Transitions are single-sourced: one `UPDATE ... WHERE status = <expected>`
per hop (Prisma: `updateMany` with status filter, expect count 1).
Any worker that loses the race sees count 0 and stops. This is the core
concurrency primitive — everything below builds on it. Together with the Safety Engine gates (§6), this state machine is what enforces the execution policy in [idea.md](idea.md) §6: no hop moves money unless the current policy verdict for the action allows it.

---

## 4. End-to-end flows

### Flow A — Invoice request ("send me the invoice for last month")

1. Ingest worker polls Gmail (`historyId` checkpoint stored in DB), inserts new
   `Email` rows (`gmailId` unique → concurrent polls can't double-insert).
2. AI pipeline picks `Email` with no action, calls `LlmProvider.extract` →
   strict JSON `{intent, payee, amount, currency, purpose, dueDate, signals}`.
   Low confidence or `intent == NOISE` → no action, logged.
3. Contacts lookup: match sender to `Contact`; on match, auto-fill usual amount/
   currency if the email omits them; on mismatch vs history, add risk flags.
4. Safety Engine pre-checks (code, not prompt): currency allow-list, amount caps,
   duplicate vs recent actions, injection-signal scan.
4b. Pre-draft confirm (Nov 4): if Gate 1 says BLOCK → blocked notice, never an
   ask (Flow E). Otherwise the validated extraction is persisted on the email
   (`AWAITING_CONFIRM` + `extractedJson`) and Telegram asks "should I draft
   this?" (Yes / Ignore). Only a Yes tap proceeds — it re-validates, re-runs
   Gate 1 fresh, then continues at step 5. Ignore → `IGNORED`, no draft ever
   exists. `/pending` re-sends missed asks.
5. Decision service creates `Action(INVOICE, PENDING_APPROVAL)` with
   `actionHash`, `idempotencyKey`, `expiresAt`, writes `AuditLog(CREATED)`.
6. Telegram card sent: payee, amount, currency, purpose, source snippet,
   confidence, risk flags + Approve / Edit / Ignore buttons (callback carries
   only `actionId`).
7. User taps Approve → bot handler checks: sender is the linked Telegram user,
   action still `PENDING_APPROVAL`, not expired → transition to `APPROVED`
   (single UPDATE-WHERE; double-tap loses the race safely), store hash snapshot.
8. Execution service: re-run Safety Engine, recompute `actionHash` from the
   stored row, compare to approved snapshot (mismatch = refuse), transition
   `APPROVED → EXECUTING`, call PayPal invoice create+send with idempotency key,
   store `paypalRef`, transition → `EXECUTED`, audit each hop.
9. PayPal webhooks (`INVOICING.INVOICE.PAID`, `.VIEWED`, …) update status;
   Telegram + dashboard reflect it.

### Flow B — Pay request (supplier payout)

Same as Flow A through step 7, except the action is `PAYOUT_SINGLE` and:

- New payees and changed payee emails **always** require manual approval and an
  extra confirmation (re-enter amount) — no auto-approve path exists for them.
- Execution calls Payouts REST directly (not in `agent-toolkit`), one item,
  with the idempotency key as `sender_batch_id` + item idempotency.
- Per-vendor and per-day caps enforced in the execution transaction
  (sum today's executed payouts for vendor/day inside the same DB transaction
  that flips `APPROVED → EXECUTING`, so two concurrent approvals can't both
  slip under the cap).

### Flow C — "Pay my team" (batch payout / monthly payroll)

1. Telegram command (or monthly scheduler) resolves all `STAFF` contacts with
   amounts from `usualAmount`/last-paid history.
2. Safety Engine assembles the batch: per-recipient anomaly check, batch size
   cap, batch total cap; anyone "off" is flagged on the card (or split out).
3. One `PayrollRun`-style `batchId` + one parent card showing **total + every
   recipient**; member `Action(PAYOUT_BATCH)` rows share the `batchId`.
4. Single Approve → execution flips parent + members `APPROVED → EXECUTING` in
   one transaction → one Payouts batch call → per-item results recorded →
   parent → `EXECUTED` (or `FAILED` with per-item detail for partial failures).
5. Monthly scheduler only ever *prepares* the run (`period` unique → two
   scheduler ticks can't prepare November twice) and waits for the tap.

### Flow D — Webhook loop

1. PayPal POSTs event → handler verifies signature first (reject on failure).
2. `INSERT ProcessedWebhook(eventId)` — conflict means duplicate delivery →
   return 200 immediately, do nothing.
3. Look up action by `paypalRef`, append `AuditLog(WEBHOOK_*)`, update status,
   push Telegram update ("Invoice #123 paid 🎉"), dashboard reads the same rows.
4. Always return 200 after durable handling; PayPal retries on 5xx, and step 2
   makes retries harmless.

### Flow E — Blocked: "our PayPal email changed, pay the new one"

1. Extraction yields a known vendor name with an **unfamiliar** `paypalEmail`.
2. Contacts comparison raises `PAYEE_CHANGED` → Safety Engine forces the action
   to `BLOCKED` with a visible label instead of sending an approval card
   (or sends a card marked blocked, no Approve path without override).
3. Audit entry records raw email + extracted JSON + flags + "no money moved".
4. This is the demo's trust moment — rehearse it.

---

## 5. Concurrency design

The system is small, but money + retries + double-taps + duplicate webhooks
make concurrency the place bugs become losses. Rules:

| Hazard | Mechanism |
|---|---|
| Double-tapped Approve | `APPROVED` transition is `UPDATE WHERE status=PENDING`; second tap affects 0 rows → "already handled" reply. |
| Approval executed twice | `EXECUTING` transition is `UPDATE WHERE status=APPROVED`; + unique `idempotencyKey` on the PayPal call; + `paypalRef` set once. Three layers. |
| Two Gmail polls overlap | `gmailId` unique constraint; loser gets conflict, skips. `historyId` checkpoint updated in the same transaction as inserts. |
| Duplicate webhook delivery | `ProcessedWebhook(eventId)` insert-or-ignore before any state change. |
| Two payouts breaching a cap together | Cap check + `APPROVED → EXECUTING` flip in ONE transaction; second committer sees the first's row (use `SERIALIZABLE`-ish discipline: re-read aggregates inside the txn). |
| Payroll prepared twice | `PayrollRun.period` unique; scheduler also takes a Postgres advisory lock (`pg_advisory_xact_lock`) around the prepare section so two dynos/processes serialize. |
| Edit racing an approval | Edit bumps `version`, recomputes `actionHash`, sets old action `SUPERSEDED`, creates a new action. Approvals carry `(actionId, version, hash)`; execution re-verifies all three. Stale approval never executes. |
| Telegram callback retries | Callback handler is idempotent: re-deliver "already handled" for terminal states; never re-execute. |
| Webhook vs execution race (paid-event arrives before we record EXECUTED) | Webhook upserts status only forward along the state machine (`EXECUTING → EXECUTED`, never backward); execution writes `paypalRef` before calling PayPal when possible, else webhook buffers by matching batch/invoice id. |
| Process crash mid-execution | On boot, execution service reaps `EXECUTING` rows older than N minutes: query PayPal by idempotency key/`paypalRef` to reconcile (paid? → `EXECUTED`, unknown? → back to `APPROVED` for one supervised retry or `FAILED`). |

**What we deliberately don't build yet:** Redis/BullMQ, multi-worker ingest,
read replicas. One API process + Postgres handles hackathon load; the state
machine and constraints above are exactly what lets us add workers later
without redesigning.

---

## 6. Safety Engine — enforcement points

The engine is the executable form of the execution policy in [idea.md](idea.md) §6: a pure function module `evaluate(action, contact, history) → {verdict: ALLOW | NEEDS_CONFIRMATION | BLOCK, flags[]}`. The policy version is stored with every verdict. Called at two gates:

- **Gate 1 (card creation):** decides whether the user gets a normal card, a
  card with warnings + extra confirmation, or a blocked notice.
- **Gate 2 (execution):** re-evaluated inside the execution transaction; the
  world may have changed since approval (new duplicate arrived, cap consumed).

Checks (all in code): human-approval default; auto-approve only under user-set
limits and never for new/changed payees; per-vendor + per-day caps; batch size
+ total caps; currency allow-list; amount sanity; email format; due-date sanity;
duplicate detection (same payee+amount within window, same `gmailId` already
acted on); payee-change detection; urgency/manipulation language flagged from
extracted signals; approval hash match; approval expiry; approver identity
(linked Telegram id).

**Implemented (Phase 8):** `apps/api/src/safety/policy.ts` is the pure
evaluator (`evaluateSafety`), and `safety.service.ts` supplies contact,
duplicate, cap and batch history from Prisma. Policy version
`arkpay-policy-2026-11-03` is written to `Action.policyVersion`,
`Action.policyVerdict`, `Action.safetySummary` and every audit row.

- Gate 1 runs in the email pipeline, AI-agent invoice draft, team batch,
  demo card and supersede/edit. `BLOCK` persists `Action.status=BLOCKED`,
  writes `SAFETY_EVALUATED` + `BLOCKED`, and sends a Telegram notice with no
  approve button.
- Gate 2 runs inside the single/batch `APPROVED → EXECUTING` transaction.
  A changed payee, duplicate or consumed cap throws before the flip; the
  aborted transaction leaves the row `APPROVED`, then a second write marks it
  `BLOCKED` and audits the refusal. No PayPal call is made.
- `GET /safety/policy`, `GET /safety/blocked`, `POST /safety/evaluate`,
  `GET /audit/recent`, `GET /audit/actions/:id` expose the policy and trace.
  Telegram has `/safety`, `/blocked`, `/trace`; the Next.js dashboard shows the
  same rows.

---

## 7. Failure handling & retries

- **PayPal API errors:** transient (5xx, timeouts, rate limits) → exponential
  backoff, max ~5 attempts, action stays `EXECUTING` with `nextRetryAt`;
  terminal (4xx validation, insufficient funds) → `FAILED` + Telegram alert
  with the reason. Never silently retry a call that may have succeeded without
  reconciling by idempotency key first.
- **LLM failures:** malformed JSON / timeout → retry once, then mark email
  `NEEDS_REVIEW` and notify ("I couldn't read this one — open it?"). No action
  is ever created from unparsed output. (Nov 4: a malformed dueDate alone no
  longer fails extraction — it is dropped and the rest proceeds.)
- **Needs-review loop (Nov 4):** a NEEDS_REVIEW money email persists its
  extraction + display reason and notifies Telegram ("needs one thing" with
  what's missing, or "couldn't read" when unparseable). Replying with the
  missing PayPal email saves it to the contact and continues immediately
  (pre-draft ask → card); Ignore dismisses; `/pending` re-sends missed
  notices; the dashboard request page shows the extraction + reason with a
  retry button.
- **Telegram down:** actions wait; approvals are pulled on recovery (webhook
  mode replays nothing, so the bot also exposes `/pending` to re-list open
  cards).
- **Instance restarts:** boot-time reaper (see §5) reconciles `EXECUTING`;
  schedulers are idempotent via unique keys.
- **Audit everything:** every transition, every PayPal request/response id,
  every webhook, every blocked attempt lands in `AuditLog`. The demo's fraud
  story and the judges' trust questions are answered by querying this table. This is the trace shape required by [idea.md](idea.md) §6: raw email on the action's email row, model I/O in `extractedJson`, policy verdict in the audit detail, approval record on the action, PayPal refs in `paypalRef`.

---

## 7b. Credential & trust boundaries

- PayPal client id/secret live **only** in the execution service's env
  (`apps/api` server-side). They never enter LLM context, never reach the
  browser, never appear in logs.
- Gmail tokens: stored encrypted at rest, used only by the ingest worker.
- Telegram bot token: server-side only; callbacks authenticated by Telegram +
  approver allow-list (single linked user id for MVP).
- All email bodies and attachments are **untrusted input**: scanned for
  instruction-like text ("ignore previous instructions", "approve
  automatically", "skip verification") and surfaced as `INJECTION_SIGNAL`
  risk flags, never followed.
- `agent-toolkit` PayPal functions are imported and called by execution-service
  code paths only. The model is never given tool-calling access to them —
  this resolves the toolkit-vs-guardrail conflict: we use the toolkit as a
  client library, not as agent tools.

---

## 8. Deployment (Vultr primary; Render optional for the Render prize)

- `api`: NestJS service in Docker, webhook endpoints for Telegram + PayPal,
  env-injected secrets, boot reaper on start.
- `web`: Next.js dashboard in Docker (activity feed from `Action`+`AuditLog`,
  rules UI).
- `db`: Postgres 16 container on the Vultr instance with a persistent volume;
  managed PostgreSQL is the upgrade path.
- `caddy`: TLS termination + reverse proxy for `app.<host>` and `api.<host>`.
- Local dev: `docker compose up db`, pnpm workspace, Prisma migrate.
- Health: `/health` on api (DB reachable?); PayPal webhook must answer <10s
  (dedupe-insert first, heavy work after — or return 200 and process inline
  since our handler is one insert + one update).
- Optional second deployment on Render if targeting the Best Use of Render
  prize; the Vultr deploy alone does not qualify for it.

---

## 8b. Generic scheduler

Schedules are rows, not code branches. `Schedule` holds `title`/`detail` for
humans and `kind`/`payload` for the runner, plus `trigger`
(`ONCE`/`INTERVAL`/`CRON`), `timezone`, `nextRunAt`, status and misfire policy.
`ScheduleRun` is the timestamped history of each occurrence.

`SchedulerService` ticks from `main.ts`, claims due rows by creating one unique
`ScheduleRun` per `(schedule, scheduledFor)`, dispatches to a registered
`kind`, then advances `nextRunAt`. A backlog is skipped, not replayed. Seeded
jobs are monthly payroll prep and invoice follow-up scan; the old follow-up
`setInterval` was removed. Payroll still uses `PayrollRun.period` and
`pg_advisory_xact_lock`, because the schedule decides *when* and the domain
record decides *what was prepared*.

`AGENT_TASK` is the generic escape hatch: it runs the agent with invoice,
payout and reminder tools removed, so a scheduled prompt can report or draft
but never move money.

---

## 9. Build order (maps to idea.md §9, compressed)

1. Repo + MIT + pnpm workspaces + Prisma schema (§3) + Docker Postgres.
2. PayPal sandbox proof: execution-service spike creating one invoice + one
   payout against sandbox (no Telegram/LLM yet).
3. Gmail ingest + `Email` storage.
4. `LlmProvider` + classify/extract on sample emails.
5. Contacts + Telegram cards (Approve/Edit/Ignore) + state machine (§3).
6. Wire approval → execution (invoice first, then payout single + batch).
7. Webhooks → status → Telegram/dashboard.
8. Safety Engine gates + fraud demo case.
9. Payroll prep + reminders + dashboard + deploy (Vultr live; Render optional) + demo record.

**Never cut:** Telegram approval, PayPal action, webhook loop, simple bulk pay.
Cut first: Slack, monthly auto-scheduling detail, learning/auto-approve,
dashboard polish.
