# ArkPay — Progress Summary

**As of:** Nov 4, 2026 (12:15 AM UTC)
**Deadline:** Nov 12, 2026, 12:00 PM PST
**Status:** Phases 0–5, Phase 8 and Phase 8b are complete and deployed. Phase 7 webhooks are verified for invoice PAID, duplicate replay, forged rejection, payout failure and agent notification. Phase 6 payout state machine is verified, but the real sandbox `SUCCESS` remains blocked because the business account is not Payouts-enabled. The app is live on Vultr, and the Telegram bot is a tool-using AI agent (Vercel AI SDK 5 + Vultr/DeepSeek) with persisted memory, read-only PayPal toolkit tools, live balance, vision/files, PDF statements, and a generic DB-backed scheduler for payroll and reminders.

ArkPay is the hackathon core loop: a money request arrives by email → an LLM extracts a strict action → the owner approves it in Telegram → PayPal executes it (invoice or payout) → webhooks close the loop → every step is auditable. Postgres is the source of truth; the model never sees PayPal credentials or tools.

---

## Completed

### Phase 0 — Credential + environment verification ✅

`pnpm test:connections` exits **0** with five green probes:

| Probe | Result |
|---|---|
| PayPal sandbox OAuth + invoices list | PASS |
| OpenAI-compatible LLM endpoint (`META_MODEL_URL`) | PASS — `deepseek/deepseek-v4.1-flash-1017` |
| Telegram `getMe` | PASS — `@OpencommercelensBot` |
| Gmail OAuth refresh + profile | PASS — inbox reachable, read-only scope |
| Postgres `prisma migrate status` | PASS — schema up to date |

Built:
- `scripts/test-connections.mjs` — zero new dependencies, Node 20 `fetch`, manual `.env` parser, never prints secret values.
- `scripts/gmail-oauth.mjs` — one-time Gmail consent helper with two modes: a localhost callback listener, or `--exchange <redirect-url>` for when the browser cannot reach the container. Writes `GMAIL_REFRESH_TOKEN` / `GMAIL_ADDRESS` into `.env` without echoing them.
- `pnpm gmail:oauth` script and the missing `META_MODEL_URL` entry in `.env.example`.

### Phase 1 — PayPal execution core ✅

- `apps/api/src/paypal/paypal-auth.service.ts` — client-credentials token with an in-memory cache, sandbox/live base-URL switch.
- `apps/api/src/paypal/paypal-invoices.service.ts` — `createDraftInvoice` + `sendInvoice` over plain REST.
- `apps/api/src/spike-invoice.ts` — one-shot create-and-send CLI, plus idempotent resend by invoice id.
- **REST, not `@paypal/agent-toolkit`:** the toolkit is framed as an agent-framework integration and is not needed for server-side execution; the REST endpoints are fully verified. Payouts will use direct REST too.
- Credential boundary: only `paypal/` reads `PAYPAL_*`; nothing PayPal-related is ever exposed to the model.

Verified on the sandbox:
- `INV2-RSUX-9AVG-EH3Y-N3GA` — `SENT`, 1.00 USD.
- `INV2-NK9G-BPB5-CFWA-DBWH` — fresh create + send, `SENT`, 1.00 USD.
- Resend of an already-sent invoice returns `422 INVOICE_ALREADY_SENT`, treated as idempotent success — no duplicate send.

### Phase 2 — Gmail ingest ✅

New `apps/api/src/ingest/` module:

| File | Responsibility |
|---|---|
| `gmail-auth.service.ts` | Refresh-token → access token, cached to expiry −60s |
| `gmail-client.service.ts` | Thin Gmail REST client: profile, messages, history |
| `email-parser.ts` | MIME walk (text/plain → HTML→text → snippet), body cap 100k |
| `gmail-ingest.service.ts` | Full sync, history sync, dedupe, transactional persist |
| `gmail-poller.service.ts` | 60s poller, started only from `main.ts` |
| `ingest.controller.ts` | `POST /ingest/run`, `GET /ingest/status` |
| `ingest.module.ts` | Nest wiring |

Data model:
- New `GmailCheckpoint { mailbox @id, historyId, lastSyncAt, updatedAt }`, migration `20261103145958_gmail_ingest`.
- The checkpoint and the `Email` inserts commit in the **same transaction**, so a crash can never advance the cursor past unstored mail.
- `Email.gmailId` stays `@unique`; inserts use `createMany(..., skipDuplicates: true)`.

Sync strategy:
- **First run:** bounded full sync (`GMAIL_FULL_SYNC_MAX`, default 50). The cursor is anchored at the historyId observed *before* listing, so messages arriving mid-sync are caught by the next history tick; the unique `gmailId` makes the overlap harmless.
- **Steady state:** `history.list` from the stored cursor every ~60s, filtered to `INBOX` additions.
- **Quota safety:** at most `GMAIL_HISTORY_MAX` (default 40) new messages per tick. The cursor advances only between fully processed history records, so a capped tick resumes exactly where it stopped — no skipped mail.
- **Failure safety:** permanent 404s (message deleted) are skipped; quota/429/5xx/auth errors throw, leaving the cursor unchanged for a retry.
- **Expired history:** a 404/410 on `history.list` triggers a bounded full resync.

Verified:
- Full sync: 50 listed → 50 inserted, all `NEW`.
- Real history re-ingest: a deliberately deleted row came back exactly once (`1 added, 1 new`).
- Repeat polls and restarts: 0 inserted, no duplicates.
- **Live gate:** inbound email “Debt” received 15:08:11 UTC, stored 15:08:39 UTC — **28 seconds**. A second live newsletter landed in 54s.
- Final DB check at the Phase-2 gate: **53 rows, 53 distinct `gmailId`, 0 duplicate groups** (54 after one more newsletter arrived at 15:13 UTC).

### Phase 3 — `LlmProvider` + extraction ✅

- `apps/api/src/llm/`: `ExtractionSchema` (zod, strict fields + superRefine), `LlmProvider` seam, `OpenAiCompatibleProvider` posting to `{META_MODEL_URL}/chat/completions` with one validation retry, `LlmService.classify/processStoredEmail`, and 20 fixtures covering invoices, pay requests, noise, urgency, and injection attempts.
- `pnpm --filter @arkpay/api test:fixtures` imports the compiled `dist` code and runs 20 live extractions. **Final score: 20/20 (100%), exit 0.** First run was 13/20; prompt tuning fixed address-only payee fallback, invoice billing-org vs person, urgency/past dates as due dates, purpose wording, and the attached-invoice vs issue-invoice distinction.
- Build fixes made during integration: installed the missing `zod` dependency and worked around the project's `strictNullChecks:false` union-narrowing failure in the retry path.

### Phase 4 — Contacts + Telegram cards ✅

- `apps/api/src/contacts/`: `ContactsService` matches on PayPal email first then `name+kind` (with a P2002 race fallback), learns `usualAmount` as a running average, updates `payCount`/`lastPaidAt`, and parses `Name <email>` senders. `GET /contacts` exposes the book.
- `apps/api/src/telegram/`: `TelegrafModule` with `launchOptions:false`; `main.ts` starts polling locally or registers a webhook when `TELEGRAM_MODE=webhook`. Decision cards show payee, PayPal email, amount/currency, purpose, source snippet, confidence, risk flags, and a Known/New payee line, with Approve / Edit / Ignore buttons.
- `DecisionService` enforces approver identity, `PENDING_APPROVAL`, and expiry, using one `UPDATE-WHERE` transition plus transactional `AuditLog` rows. `/pending` re-sends open cards; `/whoami` returns the caller's Telegram id.
- Webhook header verified: `X-Telegram-Bot-Api-Secret-Token` (Bot API `setWebhook` docs) and enforced by `TelegramWebhookController`.
- Verified through the real webhook handler with simulated callbacks: non-approver → `forbidden` (status unchanged), approver → `APPROVED` exactly once, second tap → `already_handled`, and `APPROVED`/`IGNORED`/`EXPIRED` audit rows. Card render captured with `Known payee · 1 prior payment(s) · usual USD 450.00` and all three buttons.
- **Live verified:** `TELEGRAM_APPROVER_ID=7212609303`; a card was delivered (`messageId 5`) for action `cmw0uwwzs0001d76qcjcdf1wb`, and the real Approve tap flipped it to `APPROVED` with audits `CARD_SENT → APPROVED`. The `/telegram/demo-card` endpoint is a demo-only, unauthenticated surface and should be guarded before deploy.

### Phase 5 — Approval → invoice execution ✅

- `apps/api/src/approvals/`: `action-hash.ts` is the single 6-part canonical hash (`payeeName|payeePaypal|amount|currency|purpose|idempotencyKey`, amount normalized to 2dp). `ApprovalsService.executeApprovedAction` re-verifies state, expiry, hash, and approval version; enforces caps and flips `APPROVED/FAILED → EXECUTING` in one transaction with per-vendor and global advisory locks; creates/sends the invoice; stores `paypalRef`; flips `EXECUTED`; audits every hop. Anything unexpected refuses fail-closed.
- Resume/recovery: a prior `paypalRef` is checked via `getInvoice` (reuse DRAFT, adopt SENT, recreate on 404/CANCELLED); the boot reaper (`POST /approvals/reconcile`) requeues stale `EXECUTING` rows with no ref and reconciles SENT invoices to `EXECUTED`.
- `supersede` voids an approved/pending action and creates a fresh `PENDING_APPROVAL` action with a new key/hash/version/expiry. The old approval can never execute.
- Telegram Approve now auto-executes in the background and sends a receipt; the handler starts execution before any Telegram UI call, so a UI failure cannot block a committed approval.
- Verified: `INV2-BXAP-3U5A-6CGZ-3H4E` (450.00), `INV2-DZXA-5PF5-RG7W-FG5M` (123.45, tap path), and `INV2-W5RU-333U-BAJ4-KM9A` (500.00, post-supersede) all `SENT`. Re-execution returned the same ref. Old superseded action → `wrong_state`; tampered payee → `hash_mismatch`; expired approval → `EXPIRED`; reaper `reconciled:1, requeued:1`.
- Scope note: caps govern money OUT, so invoices pass until Phase 6; invoice contact learning waits for the paid webhook (Phase 7); full Safety Gate 2 is Phase 8.

### Phase 9 (partial) — Vultr deployment ✅

- **Live:** web `https://app.139.84.249.48.sslip.io`, API `https://api.139.84.249.48.sslip.io` (health 200).
- **Infrastructure:** Vultr Cloud Compute `vhf-2c-4gb` in `jnb` (Johannesburg), Ubuntu 24.04, 2 vCPU / 4 GB / 128 GB NVMe, automatic backups enabled.
- **Stack:** Docker Compose with Postgres 16 container (persistent volume), NestJS API, Vite SPA web, and Caddy for automatic Let’s Encrypt TLS on the sslip.io hostnames.
- **Firewall:** SSH only from the admin IP and the deployment workspace IP; 80/443 public; no database/API/web ports published.
- **Telegram:** webhook mode registered at `https://api.139.84.249.48.sslip.io/telegram/webhook` with the secret header enforced (401 without it).
- **Verified on production:** a synthetic inbox email went through the real pipeline (`POST /pipeline/run` → extraction → action → Telegram card for Ada Obi / flyers / $450), the approval executed it, and PayPal invoice `INV2-VWRJ-NCFU-DP99-PMKV` is `SENT`; a direct card check also produced `INV2-GGHF-98PR-CTS5-CNBN` (1.00 USD). DB state is `EXECUTED`, 0 pending. Historical inbox backlog was drained to `IGNORED`, so only new mail cards.
- **Runbook:** `deploy/vultr/README.md`; production env template: `deploy/vultr/env.production.example`.
- **Caveats:** sslip.io is a demo hostname, not a real domain; Postgres is a single container (Vultr backups enabled, no off-instance `pg_dump` yet); one app instance; Vultr does not qualify for the Best Use of Render prize, so a parallel Render deploy is still worth considering.

### AI agent loop + tools ✅

- **Real agent loop:** Vercel AI SDK 5 (`ai@5`) with `@ai-sdk/openai-compatible@1.0.61` and Vultr/DeepSeek tool calling. No regex routing decides actions.
- **Memory:** `AgentMessage` model (`20261103190612_agent_memory`), last 20 messages per Telegram user; `/reset` clears it.
- **Custom tools:** `get_paypal_balance`, `get_account_summary`, `get_spend`, `list_pending`, `search_emails`, `lookup_contact`, `create_invoice_draft`, `follow_up_invoice`, `generate_statement`.
- **PayPal Agent Toolkit:** read-only subset only — `paypal_list_invoices`, `paypal_get_invoice`, `paypal_search_invoicing`, `paypal_list_transactions`, `paypal_list_disputes`, `paypal_get_dispute`. `send_invoice`, `pay_order`, `create_refund`, `record_payment`, orders and subscriptions are disabled. The toolkit has no payouts or balance tools.
- **Safety:** invoice creation only produces a `PENDING_APPROVAL` action/card; execution remains in the verified approval → PayPal → audit path. Tool args are Zod-validated and capped at 6 steps / 45s.
- **Balance:** `/v1/reporting/balances` returns the real wallet balance and withheld amount. Transaction Search (`reporting/search/read`) was enabled on the sandbox app and also authorizes the balances endpoint; production reports **$5,000.00 USD** available, $0.00 withheld.
- **Voice/files:** Telegram OGG → Vultr `whisper-large-v3-turbo`; PDF (`pdf-parse` v2), text, CSV, JSON and audio → agent.
- **PDF statements:** `pdfkit` generates the statement and the agent attaches it.
- **Follow-ups:** every 6h, executed invoices are checked and reminded at 3/7/14 days; stages audited.
- **Vision:** photos and image documents are transcribed by `VisionService` (`VISION_MODEL_NAME`); verified with `mimo-v2.6-flash`. Scanned PDFs ask for photos because the server has no PDF renderer.
- **Agent money-out:** `request_payout` creates a `PENDING_APPROVAL` `PAYOUT_SINGLE` through Gate 1 + the normal card; refunds ride it with a `Refund: …` purpose. Verified live: $5 to a supplier → pending, `NEW_PAYEE`, one card, no execution.
- **Multi-window transaction search (PayPal’s 3-year history):** `PaypalTransactionsService` merges ≤31-day windows; verified Oct 1–Nov 3 as 2 windows / 1 row / USD 5,000.00, Q3 as 3 windows / 0 rows.
- **Verified:** production greeting, real PayPal balance ($5,000.00), account state, spend, email search, PayPal invoice list/status, invoice draft → approval → `INV2-XWT9-K46B-98XA-XHRT` executed, memory recall, PDF statement, PDF read, voice transcript; locally verified vision (`mimo-v2.6-flash`), agent payout draft, and multi-window transaction search. Unsupported fallback also verified.
- **Still next:** video understanding, voice replies (TTS), text-based edit/approve, future-dated/recurring invoices.

### Phase 9b — Agent chat + list endpoints (dashboard API surface) ✅

- **Chat:** `POST /agent/chat` (`agent/agent-chat.controller.ts`) streams the existing Vercel AI SDK 5 agent over SSE via `AgentService.runStream` — same model/tools/history/Gate-1 path as Telegram, shared `AgentMessage` memory. Events: `text-delta`, `tool-call`/`tool-result` (summarized, no secrets), `draft` (approval-card payload per created draft), `document` (base64 statement PDF), exactly one terminal `done`/`error`. Drafts still card to Telegram and audit with origin `agent-chat`; `GET /agent/messages?since=` replays history; client disconnect aborts the run (120s cap).
- **Attachments:** JSON base64 + `multipart` uploads (PDF, image, audio, text/CSV/JSON) reuse the Telegram ingest path and prompts, including the scanned-PDF photo nudge. JSON body limit raised to 25mb in `main.ts`.
- **Lists (all cursor-paginated with `totalCount`):** `GET /approvals` (pending-first), `GET /ingest/emails` + detail (snippet vs full body + linked actions), `GET /invoices` + detail (live PayPal status, reminders, webhook events), `GET /payouts` + `/payouts/batches` + member roll-ups, `GET/PATCH /contacts/:id` (history, edit; no deactivate — no status field).
- **Refactor:** `run()`'s pending-draft completion extracted to `maybeCompletePending` (shared with `runStream`, behavior-identical); audit `via` threaded through an `origin` option defaulting to the existing Telegram values.
- **Gate:** `pnpm --filter @arkpay/api test:agent-chat` boots the real HTTP app on an ephemeral port — 6/6 pass, exit 0: streamed payout draft → one `PENDING_APPROVAL`, `paypalRef` null, audit origin `agent-chat`; readOnly strips money tools and creates nothing; JSON + multipart attachments ingested; history replay; all lists 200 with cursor round-trips; contacts get + patch. Zero leftover rows. Side effect: one real Telegram decision card per run (action deleted after, so its tap lands on `not_found`).

### Phase 10a — Tenancy foundation (identity + tenant columns + auth) ✅

- **Decisions (user-settled):** Google sign-in, full tenancy (per-user Gmail/Telegram/PayPal), personal-only workspaces (Workspace modelled explicitly so orgs stay possible).
- **Schema:** `User`, `Workspace` (credential fields + timezone/currency), `Session`, `TelegramLink`; nullable `workspaceId` on 8 tables; uniques per-workspace (contact, email, payroll, schedule). Migration `20261104052350_tenancy_identity` backfilled all rows into the `owner` workspace (zero NULLs verified).
- **Auth:** Google OAuth code flow (HMAC-signed stateless state), DB-backed opaque sessions (30d, `arkpay_session` cookie), `SessionAuthGuard` + `@CurrentWorkspace()` per-route. First signup adopts `owner`; later signups get seeded workspaces. Gmail connect (readonly + offline) and PayPal connect (live probe before storing; secret plaintext MVP, documented risk) per workspace; Telegram `/link <code>` pairing.
- **Scoping pattern:** `ContactsService` fully tenant-threaded; agent drafts/history, pipeline, supersede, payroll, scheduler seeds, and demo writes already carry `workspaceId`. Transition fallbacks (session-less → owner) are marked for removal in 10d.
- **Gate:** `test:tenancy` 6/6, exit 0 — guard 401s, adoption + session lifecycle + secret redaction, fresh workspace + seeds + link code, contacts A/B isolation + uniques + session-scoped HTTP, pairing state machine, OAuth builders + PayPal probe rejection. No regressions (`test:agent-chat`, `test:scheduler:e2e` green). `.env` gained a fresh `SESSION_SECRET` (was missing entirely).
- **Still next (10c–10d):** multi-tenant poller/scheduler/cards/webhooks, guard-all + NOT NULL + fallback removal. Live Google round-trip stays manual.

### Phase 10b — Tenant scoping (all writers + readers) ✅

- **Writers:** all 12 create sites carry `workspaceId` — batch assembly (STAFF reads scoped too), email ingestion (mailbox-owned tenant), `scheduler.create`, webhook dedupe rows (attributed to the matched tenant after routing), checkpoints. Unresolved machine paths fall back to `owner` (removed in 10d).
- **Readers:** contacts, approvals (list + by-id `not_found` on mismatch), agent history + all 9 read tools, ingest, pipeline, safety Gate-1/Gate-2/blocked, scheduler (all six paths), payouts/payroll, audit, invoices, chat history. Cross-tenant reads return empty — no existence leak.
- **Money gates:** approval taps verify the action belongs to the tapper's linked workspace (`decide`/`decideBatch`); HTTP execute/supersede verify the session tenant. Telegram read commands resolve via link.
- **Gate:** `test:tenancy` extended to 10/10 — action isolation, execution checks, decision positive+negative, asymmetric duplicate proof, schedule/payroll HTTP isolation. Full regression green (`test:agent-chat`, `test:scheduler:e2e`, `test:safety:e2e`, `test:payouts:mock`, both unit suites); e2e fixtures stamped `workspaceId: 'owner'`. PayPal probe moved into WorkspacesService to avoid a module cycle.

### Phase 10c — Multi-tenant machine paths ✅

- **Gmail:** poller iterates workspaces with stored Gmail connections (per-workspace token cache + existing per-mailbox checkpoint). Manual `POST /ingest/run` syncs the caller's own mailbox.
- **PayPal:** `PaypalAuthService.context(workspaceId)` resolves per-workspace creds/mode with a per-workspace token cache; execution, follow-ups, reconcile, agent tools (incl. the read-only Agent Toolkit subset, cached per workspace), and invoice detail thread the tenant.
- **Telegram:** cards, receipts, and documents route to the action's workspace link; agent doc replies go back to the asking chat.
- **Webhooks:** tenant pre-attributed from the unverified resource, signature verified with that tenant's creds + `paypalWebhookId` (migration `20261104062544_paypal_webhook_id`); agent-first notifications route to the matched tenant. `POST /paypal/webhooks` stores the subscription id on the workspace.
- **Staging:** `owner:connect-gmail` / `owner:connect-paypal` copy the legacy env app onto the owner row (probe-then-write, idempotent). Scheduler needed no change (per-row tenant + atomic claim already fair — proven by a cross-tenant tick).
- **Gate:** new `test:multitenant` 13/13 — live owner Gmail sync via stored creds, bogus-token rejection, poller shape, live PayPal token + stored-row proof, link routing (fake transport), pre-attribution, fairness tick.

### Phase 10d — Enforcement (guard-all + NOT NULL + no fallbacks) ✅

- **Guard-all:** `SessionAuthGuard` on all 13 user controllers + the two PayPal setup helpers (method-level; the event receiver stays signature-authed, Telegram webhook stays secret-authed). 24-route 401 sweep in the gate.
- **NOT NULL:** migration `20261104063631_tenant_not_null` enforces `workspaceId` on Email, AgentMessage, GmailCheckpoint, Contact, Action, PayrollRun, Schedule (zero NULLs pre-existing). ProcessedWebhook stays nullable — unattributed events genuinely have no tenant. Service options that took `workspaceId?` now require it (`scheduler.create`, `payroll.prepare`/`detail`, `assembleTeamBatch`).
- **Retired:** `TELEGRAM_APPROVER_ID` (decision taps, Gate-2 expected-approver, card routing, agent-chat/scheduler identity are all link-based), the env Gmail mailbox, the shared PayPal app, every `?? owner` fallback. Only intentional owner uses remain (boot seed, adoption).
- **Fail-closed:** unlinked Telegram users get a link nudge (no data); unlinked workspaces get `CARD_SKIPPED` instead of a card; unconnected PayPal/Gmail fail before any API call; unattributed webhooks 401.
- **Gate:** `test:tenancy` extended to 13 sections — ALL GREEN; `test:multitenant` converted to strict assertions, green. Full regression green: agent-chat 6/6 (session preamble), scheduler/safety/payouts e2e, safety 25/25, scheduler 5/5, extraction fixtures 20/20. Fixes: safety-e2e targets its email via `processOne` (live inbox backlog starved the queue-head claim), payouts-mock seeds `approvedBy` from the owner link, tenancy cleanup orders action deletes before workspace delete (RESTRICT FK).
- **Still manual:** Google round-trip in the browser, Gmail connect, PayPal-signed live webhook delivery. No server was running during this pass — restart the API to pick up 10c/10d.

### Backend review fixes + dashboard API gaps (pre-frontend) ✅

- **CORS:** none existed — a browser dashboard could not call the API. Shared `configureApp()` (`WEB_APP_URL` allowlist + credentials) used by `main.ts` and the HTTP gates.
- **Item attribution:** payout-item webhooks matched internal `batchId` against PayPal's `payout_batch_id`; now matches `paypalRef` (money state was never affected — batch sync was already correct).
- **Ignore:** `POST /approvals/:id/ignore` via `decideViaSession` (same machine as taps); `DecisionService` moved to `approvals/`. Dashboard approval stays Telegram-only by design.
- **Payout detail:** `GET /payouts/:id` mirrors the invoice detail (live batch merge + webhook trail).
- **Rules:** `SafetyPolicy` versions per workspace; latest merges over global config for future evaluations; verdicts stamp `base+wN`. Full CRUD + reset.
- **Creates:** `POST /invoices` + `POST /payouts` on one `DraftService` shared with the agent tools (validation, Gate 1, audit, cards, client idempotency keys).
- **Gate:** new `test:dashboard-api` ALL GREEN; full regression green (tenancy, multitenant, agent-chat 6/6, scheduler/safety/payouts e2e, 25/25 + 5/5 units).

### Payment Safety Engine + fraud demo (Phase 8) ✅

- **Pure policy:** `safety/policy.ts` exports `evaluateSafety(...)` with policy version `arkpay-policy-2026-11-03`. No I/O, so Gate 1 (card creation) and Gate 2 (execution transaction) cannot disagree.
- **Verdicts:** `ALLOW`, `NEEDS_CONFIRMATION`, `BLOCK`; every verdict carries `flags`, human-readable `reasons`, `policyVersion` and `autoApproveEligible` (auto-approve stays 0/off by default).
- **Checks:** currency allow-list, email/amount/due-date validity, invoice maximum, per-vendor + global daily caps, batch size/total caps, duplicates, payee-change, amount anomaly, injection/urgency signals, new-payee confirmation, approval expiry/hash/version/approver identity.
- **Gate 1 coverage:** email pipeline, AI-agent invoice drafts, team batch assembly, demo-card endpoint, and supersede/edit. Blocked actions are persisted as `BLOCKED` with `SAFETY_EVALUATED` + `BLOCKED` audit rows and a visible Telegram notice with no approve button.
- **Gate 2:** re-evaluated inside the `APPROVED → EXECUTING` transaction (single and batch). A changed payee, duplicate or consumed cap marks the action `BLOCKED` before any PayPal call.
- **Persistence:** migration `20261103203000_safety_policy` adds `policyVersion`, `policyVerdict`, `safetySummary`; existing `riskFlags` holds the flag list.
- **Audit trail:** `GET /audit/recent`, `GET /audit/actions/:id`, Telegram `/trace <id>` and `/blocked`, `/safety` policy view; dashboard shows policy, blocked actions, source email and audit events.
- **Fraud demo (verified):** known payee `Acme Fraud Demo` claims a new PayPal email. Real LLM pipeline → `PAYEE_CHANGED,URGENCY` → `BLOCKED`; fake Telegram captured “Blocked by the Payment Safety Engine … No money moved”; forcing the same action to `APPROVED` and calling execute also returns `blocked`, with no PayPal call.
- **Tests:** `test:safety` **25/25** pure-policy tests; `test:safety:e2e` real pipeline + Gate 2 + Telegram rendering.

### Generic schedule engine (Phase 8b) ✅ deployed

- **Schedules are data:** `Schedule` stores human `title`/`detail`, machine `kind`/`payload`, `ONCE`/`INTERVAL`/`CRON` trigger, timezone, `nextRunAt`, status and misfire policy. `ScheduleRun` stores the timestamped history of each occurrence (`scheduledFor`, started/finished, status, result, error).
- **One runner:** `SchedulerService` ticks every 30s from `main.ts`; a unique `(scheduleId, scheduledFor)` run claim prevents double execution, and `advanceAfterRun` skips missed backlogs instead of replaying them.
- **Seeded jobs:** monthly payroll prep (`PAYROLL_PREPARE`, `0 9 1 * *`) and invoice follow-up scan (`INVOICE_REMINDERS`, `0 */6 * * *`). The old follow-up timer was removed.
- **Handlers:** `PAYROLL_PREPARE`, `INVOICE_REMINDERS`, `NOTIFY`, `NOOP`, and `AGENT_TASK` with invoice/payout/reminder tools removed (read-only scheduled agent).
- **Payroll:** `PayrollService.prepare()` keeps `PayrollRun.period @unique` + `pg_advisory_xact_lock`; schedule = when, PayrollRun = what was prepared. Endpoints `GET/POST /payroll*`; Telegram `/payroll`.
- **API:** `GET/POST /schedules`, `PATCH /schedules/:id`, `POST /schedules/:id/run`, `GET /schedules/:id/runs`. Dashboard shows schedules, next/last run, status and run history plus payroll runs.
- **Tests:** `test:scheduler` **5/5**; `test:scheduler:e2e` verifies seeding, two-tick idempotency and payroll run-now/reuse; concurrent prepare produced one batch.
- **Production:** migration applied, both schedules seeded, `/schedules` + `/payroll` + dashboard live, Telegram `list_schedules` and multi-window `search_paypal_transactions` verified, vision verified in-container with `mimo-v2.6-flash`.

### Webhook loop (Phase 7) ✅ verified

- Production webhook was pointing at the old Replit host and `PAYPAL_WEBHOOK_ID` was blank. Moved webhook `9YG02413MS108163P` to `https://api.139.84.249.48.sslip.io/paypal/webhook`, set the ID, and force-recreated the API.
- Real invoice PAID event (`INV2-VWRJ…`) → `WEBHOOK_PAID` audit + contact learning.
- Replay → one `ProcessedWebhook` row, no new audit; forged unsigned event → 401.
- Payout `J6TC65WBQVPEC` DENIED → action `FAILED` + `EXECUTION_FAILED`/`WEBHOOK_PAYOUT_DENIED`; replay → no extra audit.
- Agent notification had a `DataCloneError` on Prisma `Decimal` tool results; fixed `get_audit_trail`, `list_blocked_actions`, `lookup_contact` to return plain strings and redeployed.
- Payout webhook `SUCCESS` still waits on the Phase 6 account gate.

### Payout idempotency correction

A live probe proved PayPal can accept a second batch with the **same `sender_batch_id` and `PayPal-Request-Id`** (`7ESXTMPMX526L` → `NCPACQADJPD24`). The old assumption that PayPal would reject duplicates was unsafe. Added app-level fail-closed behavior: stale `EXECUTING` payout without `paypalRef` → `FAILED` + `PAYOUT_UNKNOWN` (no requeue), and `FAILED` payout retries are refused (`not_retryable`). `test:payouts:mock` covers single/batch SUCCESS, contact learning, failed retry and stale no-ref recovery.

---

## Bugs found and fixed

| Bug | Fix |
|---|---|
| Meta probe truncated the body before `JSON.parse` → false “non-JSON body” | Parse the full body; slice only for error display |
| Telegram probe sliced to 300 chars before `JSON.parse` → false “Unterminated string” | Same full-body parse fix |
| Blank `KEY=` lines in `.env` shadowed injected secrets | Non-empty `process.env` wins; blank `.env` values are ignored in both scripts |
| `createDraftInvoice` read a non-existent `id` field | Parse the invoice id from the response `href` / `Location` header |
| History replay was unbounded → Gmail quota exhaustion and partial backfill | Per-tick cap (40) with record-boundary cursors |
| Transient fetch failures still advanced the checkpoint → silent email loss | Only permanent 404s are skipped; everything else aborts the tick and preserves the cursor |
| Malformed MIME could fail the whole sync forever | Per-message parse guard; unparseable messages are skipped and logged |
| Phase-3 code imported `zod` but it was not installed | Ran `pnpm install`; lockfile now includes it |
| `strictNullChecks:false` broke boolean-union narrowing in the extraction retry path | Assert the error branch explicitly; build is green |
| Telegram approve awaited `answerCbQuery` before execution, so a UI error could block a committed approval | Start execution first; log UI failures instead of aborting |
| Telegram chat was a regex router, not an agent | Replaced with Vercel AI SDK 5 tool loop; commands are shortcuts into the same tools |
| `@ai-sdk/openai-compatible@2` implements provider spec v3, incompatible with `ai@5` | Pinned provider `1.0.61` (spec v2) |
| PayPal toolkit static types pulled in AI SDK 4 + LangChain + OpenAI and OOM’d Nest build | Lazy runtime `require` + 3 GB compiler cap |
| PayPal `/v1/reporting/balances` returned 403 (no Reporting scope) | Enabled Transaction Search on the sandbox app; balance and transaction endpoints now return 200 after a token refresh |
| Safety Gate 2 threw inside the execution transaction, rolling back its own audit row | Catch the block outside the aborted transaction and persist `SAFETY_EVALUATED` + `BLOCKED` there |
| Email pipeline and AI-agent invoice drafts had separate flag logic | Both call the same `SafetyService.evaluateCreation`; supersede, team batch and demo card do too |
| Follow-up `setInterval` would duplicate the new scheduler | Removed the timer; `INVOICE_REMINDERS` is now a seeded schedule and `runOnce()` is handler-only |
| Interval next-run calculation skipped based on wall-clock time in a unit test | `nextRunAfter` is pure; `advanceAfterRun` skips missed intervals after a run |
| PayPal accepted a duplicate payout batch with the same `sender_batch_id`/`PayPal-Request-Id` | Fail closed on stale no-ref payouts and refuse `FAILED` payout retries; require a new action |
| Production PayPal webhook URL was still the old Replit host and `PAYPAL_WEBHOOK_ID` was blank | Moved webhook to the production API, set the ID, force-recreated the API (restart alone does not reload env) |
| Webhook agent analysis hit `DataCloneError` on Prisma `Decimal` tool results | Convert `amount`/`usualAmount` to strings before returning from agent tools |

---

## Current repository state

```
apps/api/src/
  paypal/        auth cache, invoice create/send
  ingest/        Gmail auth, client, parser, sync, poller, controller
  prisma/        PrismaService + module
  health.controller.ts
  spike-invoice.ts
apps/api/prisma/
  schema.prisma
  migrations/20261103113109_init
  migrations/20261103145958_gmail_ingest
scripts/
  test-connections.mjs
  gmail-oauth.mjs
```

Stack: NestJS 10, Prisma 6.19.3, PostgreSQL, TypeScript 5.9, Node 20, pnpm workspace with `apps/api` and `apps/web`.

---

## How to run

```bash
pnpm install
pnpm test:connections                 # expect exit 0, 5/5
pnpm gmail:oauth                      # only when minting a new refresh token

# Phase-1 invoice spike
pnpm --filter @arkpay/api spike:invoice -- --to <sandbox-buyer-email> --amount 1.00
pnpm --filter @arkpay/api spike:invoice -- --invoice <invoice-id>   # idempotent resend

# API + Gmail poller
pnpm dev:api                          # listens on :3001
curl -X POST localhost:3001/ingest/run
curl localhost:3001/ingest/status

# Phase-8 Safety Engine
pnpm --filter @arkpay/api test:safety       # 25/25 pure-policy tests
pnpm --filter @arkpay/api test:safety:e2e   # real pipeline fraud + Gate 2

# Phase-8b generic scheduler
pnpm --filter @arkpay/api test:scheduler      # recurrence/timezone
pnpm --filter @arkpay/api test:scheduler:e2e  # seeded jobs, tick, payroll

# Phase-6 payout state machine (PayPal stub)
pnpm --filter @arkpay/api test:payouts:mock
```

Ingest tuning lives in `.env`: `GMAIL_POLL_ENABLED`, `GMAIL_POLL_INTERVAL_MS`, `GMAIL_FULL_SYNC_MAX`, `GMAIL_HISTORY_MAX`.

---

## Corrections to earlier session notes

An earlier transcript (session `ses_e5e51686...`, 1:52–3:09 PM) contains statements that were later corrected:

1. **“Claude is the active model / Meta is dormant until the swap.”** False. Claude is not used at all; the active provider is Vultr Serverless Inference (`https://api.vultrinference.com/v1`) with model `deepseek-v4.1-flash-1017`. `LLM_PROVIDER=openai-compatible`.
2. **“Meta Model API credentials.”** Misleading. The `META_*` variable names are historical; the URL points at Vultr’s OpenAI-compatible inference API, not `api.meta.ai`. The probe is labeled “OpenAI-compatible LLM chat completion”.
3. **“Phase 3: `ClaudeProvider` via `@anthropic-ai/sdk`.”** False. The SDK was removed from `apps/api/package.json`; Phase 3 was implemented as `OpenAiCompatibleProvider` against `{META_MODEL_URL}/chat/completions`.
4. **“3/5 green / Phase 0 blocked on secrets.”** Superseded. All five probes pass and Phases 0–2 are complete; Phase 2’s live email gate passed in 28s.

`task.md`, this summary, `README.md`, `explain.md`, `idea.md`, `setup.md`, and `.env.example` were updated to match.

## Next: finish Phase 6 payouts

Phase 6 state machine is verified with a deterministic mock (`test:payouts:mock`): single and batch settle `EXECUTED`, contact learning increments, duplicate execution is idempotent. Real PayPal attempts (single, batch, retry, and three fresh probes) all create a `PENDING` batch then `DENIED/FAILED` across multiple receiver emails. That is the sandbox business account lacking Payouts enablement, not a code failure.

1. Enable **Payouts** on the sandbox business account (Dashboard → Account → Payouts → Enable / complete business verification).
2. Re-run one $1 single payout → expect `SUCCESS`/`UNCLAIMED`.
3. Re-run a two-person batch → expect `SUCCESS` with per-item audits.
4. Confirm the new fail-closed guards: stale no-ref payout → `FAILED` + `PAYOUT_UNKNOWN`; `FAILED` payout retry → `not_retryable` (covered by `test:payouts:mock`).
5. Kill mid-`EXECUTING` with a known `paypalRef` → reaper reconciles via `GET /v1/payments/payouts/{id}`.
6. Webhook payout `SUCCESS` then updates the action; failure already verified with `J6TC65WBQVPEC`.

Done: Phase 7 webhook loop verified (invoice PAID, replay, forged rejection, payout failure, agent notification). Phase 8/8b deployed. Remaining: enable sandbox Payouts and land one real single + batch `SUCCESS`, then demo recording + Devpost (9).

---

## Open risks / notes

- **Buyer email:** the Phase-1 invoices went to the placeholder `sb-buyer@personal.example.com`. The demo path should be re-run with a real sandbox buyer account.
- **Gmail quota:** the per-user limit is easy to hit on backfills; the history cap exists specifically for this. Keep `GMAIL_HISTORY_MAX` conservative.
- **Telegram:** `nestjs-telegraf@2.9.1` is installed on Nest 10 and working; the webhook header is confirmed as `X-Telegram-Bot-Api-Secret-Token`. The approver is linked (`7212609303`) and a live card was approved. The `/telegram/demo-card` endpoint is unauthenticated and demo-only.
- **Payouts:** PayPal docs claim `sender_batch_id` is a duplicate guard, but a live sandbox probe created two batches with the same id (`7ESXTMPMX526L` → `NCPACQADJPD24`). ArkPay now fails closed on stale no-ref payouts and refuses `FAILED` retries; a real `SUCCESS` still requires enabling Payouts on the sandbox business account. The invoice path remains demo-ready as fallback.
- **Unused Claude config:** the `ANTHROPIC_*` vars remain in `.env` but are never read; `@anthropic-ai/sdk` has been removed from `apps/api/package.json`. The active path is `META_MODEL_*`.
- **Secrets:** `.env` is gitignored and the production copy is `0600` on the server. Rotate `SESSION_SECRET` and both Vultr keys after the event (the Vultr keys were pasted into chat).
- **Deployment durability:** Postgres is a container on one VPS. Vultr automatic backups are on, but add a nightly `pg_dump` to Vultr Object Storage before relying on it beyond the demo.
- **Render prize:** Vultr is live, but a parallel Render deployment is still needed if targeting Best Use of Render.
- **Environment:** in this workspace `node`/`pnpm` are not on the default `PATH` (Nix store paths were used). A normal Replit/Render shell with Node 20 + pnpm does not need that workaround.
- **Deployment shell:** `/home/runner/.ssh/arkpay_vultr` disappeared after the latest environment restart. Production is healthy, but the next redeploy needs the private key restored or a new key attached to the Vultr instance.
