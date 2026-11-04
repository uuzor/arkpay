# ArkPay Frontend Spec — frontend.md

**Status:** spec only, not implemented. The current `apps/web` is a bare Next.js 15 + React 19 scaffold whose single page renders schedules, payroll, safety policy, blocked actions, and the audit trail as server-rendered tables. Everything below describes the target product surface: landing page, onboarding/auth, dashboard shell with sidebar tabs, and the persistent right-side AI bar.

**Stack:** Next.js App Router (already in `apps/web`), `API_BASE_URL` pointing at the Nest API. All data below maps to real API routes where they exist; missing routes are called out as backend gaps.

---

## 1. Landing page (`/`)

Public, unauthenticated. One page, five sections. Goal: a visitor understands the product in 30 seconds and clicks **Start free** or watches the 2-minute demo.

### 1.1 Nav bar
- Logo + "ArkPay" wordmark (left).
- Links: How it works · Safety · Pricing · Docs/GitHub.
- Right: **Log in** (ghost) + **Start free** (primary).

### 1.2 Hero
- Headline: **"Never type an invoice again. Just talk."**
- Subhead: "ArkPay reads money requests from your email, prepares the PayPal invoice or payout, gets one secure approval from you, and executes it — with fraud checks and a full audit trail."
- CTAs: **Start free** (→ `/signup`) + **Watch 2-min demo** (YouTube embed modal).
- Hero visual: a live-looking mock of the flow, three panels side by side — (1) an email snippet ("Please send the invoice for the flyers, $450"), (2) the Telegram approval card ("Send invoice · [Send invoice] [Edit] [Ignore]"), (3) the receipt ("✅ Invoice sent · INV2-…"). This is the whole product in one glance.
- Trust strip under the hero: "Built on PayPal Invoicing + Payouts · Every money move needs your tap · Full audit trail".

### 1.3 How it works (numbered, 4 steps)
1. **Connect** — Gmail, Telegram, PayPal sandbox in under 5 minutes.
2. **ArkPay reads** — every money email is classified (pay / invoice / noise) and extracted: amount, currency, person, purpose, due date.
3. **You approve once** — a clean card on Telegram (or the dashboard): who, how much, why, and the exact source quote. Approve / Edit / Ignore.
4. **ArkPay executes & follows up** — invoice sent or payout made via PayPal; webhooks confirm payment, chase late payers, flag duplicates.

### 1.4 Safety section ("Why you can trust an agent with money")
Four cards, each one sentence:
- **Approval-locked** — nothing moves without your tap; auto-approve defaults to off.
- **Payment Safety Engine** — spending caps, duplicate detection, changed-payee alerts, anomaly flags; risky moves are blocked, not just warned.
- **Every hop audited** — created → approved → executed, with who/when/why, exportable.
- **Prompt-injection aware** — "auto-approve this" inside an email body is flagged, never followed.

### 1.5 Social proof + pricing + footer
- Proof: hackathon demo stats from the real sandbox (e.g. "20/20 extraction fixtures · 25/25 safety policy tests · live PayPal sandbox invoices"). Keep every claim verifiable — no invented customer logos.
- Pricing (simple, 3 tiers): **Free** (1 inbox, 20 actions/mo), **Pro** (team payouts, payroll schedules), **Team** (multi-approver, roles). Mark as "launch pricing — TBD" until decided.
- Footer: Product / Company / Legal columns, "Built for the PayPal AI Hackathon" badge, GitHub + Devpost + YouTube links, status line (`GET /health`).

---

## 2. Onboarding + auth flow

### 2.1 Auth
- **Signup** (`/signup`): name, email, password → creates workspace. Email verification optional for MVP; session cookie via `SESSION_SECRET`.
- **Login** (`/login`): email + password. **Logout** in the user menu.
- **Backend (shipped in Phase 10):** Google sign-in only — `GET /auth/google` → `GET /auth/google/callback`, `POST /auth/logout`, `GET /auth/me`; session cookie `arkpay_session`. No email/password endpoints. All user routes are session-guarded; workspaces are personal-only. Connections: Gmail connect, PayPal credentials form, Telegram pairing code.
- Password reset via email link (post-MVP acceptable, but the UI slot should exist).

### 2.2 Onboarding wizard (`/onboarding`, 4 steps, skippable, resumable)
Shown once after signup. Progress bar at top; each step can be skipped and finished later from Settings → Connections.

1. **Connect Gmail** — "ArkPay reads money requests from your inbox." OAuth button (existing `gmail:oauth` flow, surfaced as a web redirect instead of CLI). Success state shows the connected address and a "Test: fetch latest email" confirmation. Skip → inbox features stay empty with a reconnect nudge.
2. **Connect Telegram** — "Approvals arrive here in seconds." Shows the bot handle (`@OpencommercelensBot`), a **link code** (existing `/whoami` pairing flow), and a "Send me a test card" button that fires a sample approval card so the user taps Approve once before real money exists.
3. **Connect PayPal** — sandbox by default with a visible **Sandbox / Live toggle** (live disabled until credentials + a confirmation checkbox: "I understand real money moves"). Fields: client ID + secret; "Verify" runs the OAuth + invoices-list probe and shows the wallet balance on success.
4. **Set your safety policy** — the Safety Engine defaults, editable: per-vendor daily cap, global daily cap, invoice max, allowed currencies, duplicate window, approvers (self only vs team). Auto-approve stays OFF with an explicit "keep me in the loop" preselected. Finish → confetti-free redirect to `/dashboard` with a "Send yourself a test invoice" checklist item.

### 2.3 Empty states
Every dashboard tab before connections exist shows the same pattern: what this tab will show + which connection unlocks it + a button to that onboarding step. Never an empty table with no explanation.

---

## 3. Dashboard shell + sidebar tabs (`/dashboard/*`)

### 3.1 Shell layout
- **Left sidebar** (icons + labels, collapsible to icons): Home, Approvals (badge = pending count), Inbox, Invoices, Payouts, Payroll, Schedules, Contacts, Safety, Activity, Settings. User menu + workspace switcher at the bottom.
- **Top bar:** global search (⌘K: search emails, contacts, invoices, actions), sandbox/live pill, connection status dots (Gmail / Telegram / PayPal), AI-bar toggle.
- **Main content:** tab views below. **Right rail:** the AI bar (§4), collapsible, ~360px.
- Mobile: sidebar becomes a bottom nav (Home, Approvals, AI, Activity, More); AI bar becomes a full-screen sheet.

### 3.2 Home (`/dashboard`)
The "morning glance": what needs me, what happened overnight.
- **Needs your approval** — pending cards (same content as the Telegram card v2: action + amount, bill-to/pay-to, purpose, source quote with sender + relative time, contact context, risk callout if any). Inline **Pay/Send**, **Edit**, **Ignore** buttons. Badge count matches the sidebar.
- **Money today** — real wallet balance (`/v1/reporting/balances`), in/out today, pending invoice total, overdue total. Never substitute invoice totals for balance.
- **Overnight activity** — webhook-driven events: invoice paid/viewed, payout completed/failed, reminders sent, blocked attempts. Each row links to the audit trace.
- **Upcoming** — next 3 scheduled runs + next payroll date.

### 3.3 Approvals (`/dashboard/approvals`)
The money queue. Filter chips: Pending / Approved / Executed / Blocked / Expired / All.
- Each row: type icon (invoice-out / payout / batch), counterparty, amount, purpose, risk badge (none / flags / BLOCKED with reason), age + relative expiry ("Expires in 14 min"), source-email link.
- Row click → detail drawer: full source quote, extraction confidence (shown only when low), Safety verdict + which rules fired, contact history (prior count, usual amount, email-change warning), full audit timeline, and the action buttons. Buttons state the action + amount ("Pay $780.00", "Send invoice"), never a bare "Approve".
- Batch approvals: expandable member rows; batch-level Pay executes after Gate 2; per-batch progress (succeeded/failed/pending).
- Backed by: Telegram `/pending` + `POST /approvals/:id/execute`, `/batch/:batchId/execute`, `/:id/supersede`, `/reconcile`. **Backend gap:** a `GET /approvals` list endpoint (currently only Telegram `/pending` lists them).

### 3.4 Inbox (`/dashboard/inbox`)
What Gmail ingest sees. Table: sender, subject, received time, classification badge (PAYMENT_REQUEST / INVOICE_REQUEST / NOISE / NEEDS_REVIEW), confidence, linked action (or "ignored"/"—").
- Row click → email detail: sanitized body, extracted fields side-by-side with the source text highlighted, "Create action" for NEEDS_REVIEW items, "Run pipeline" for reprocessing.
- Header: ingest status (cursor, last poll, email count), **Run ingest now** button (`POST /ingest/run`, `POST /pipeline/run`), link to pipeline status (`GET /pipeline/status`).
- **Backend gap:** list/get email endpoints (ingest stores rows; only run endpoints exist).

### 3.5 Invoices (`/dashboard/invoices`)
PayPal invoices ArkPay created. Table: invoice id (`INV2-…`), bill-to, amount, status (DRAFT / SENT / PAID / OVERDUE / CANCELLED), due date, source action link.
- Row click → detail: line items, PayPal status history, webhook events received for it, reminder history + "Send reminder now" (follow-up), "Mark paid" / cancel where valid.
- **Backend gap:** invoice list/detail endpoints (agent has toolkit read tools; HTTP surface needs `GET /invoices`, `GET /invoices/:id`).

### 3.6 Payouts (`/dashboard/payouts`)
Money out: singles + batches. Two subtabs.
- **Singles:** payee, amount, status (PENDING_APPROVAL → EXECUTING → EXECUTED / FAILED / BLOCKED), PayPal batch/item id, safety verdict, audit link.
- **Batches:** batch id, item count, total, per-item status roll-up, progress bar; failed items expandable with PayPal error + retry (reconcile-first, never blind retry).
- "New payout" button → opens the AI bar with a prefilled draft ("Pay …") that goes through `request_payout` → Gate 1 → approval card. No direct money-move form — drafts always route via approval.

### 3.7 Payroll (`/dashboard/payroll`)
- Runs table (already exists in the MVP page — keep it): period, total, status, prepared-by, batch link.
- **Prepare payroll** button (`POST /payroll/prepare`, period picker defaulting to current month): shows the assembled batch (recipients from contacts, amounts from history, flags for anyone off-pattern) for review before it becomes an approval.
- Run detail: member rows with per-person status, link to the underlying payout batch approval.

### 3.8 Schedules (`/dashboard/schedules`)
- Table (already exists in the MVP page — keep the columns): title/detail, kind, status, trigger/cron, next run, last run + result.
- Row actions: **Run now** (`POST /schedules/:id/run`), pause/resume (`PATCH /schedules/:id`), view runs (`GET /schedules/:id/runs`).
- **New schedule** (`POST /schedules`): title, handler picker (Payroll prep, Invoice reminders, Notify, Agent task, No-op) with a plain-language description of each, and a schedule builder (once / interval / cron + timezone). Agent-task schedules carry a visible "read-only" badge.

### 3.9 Contacts (`/dashboard/contacts`)
The people book. Table: name, PayPal email/ID, type (client / supplier / staff), prior count, usual amount + currency, last paid, flags (email changed, anomaly).
- Row click → contact detail: full payment history, all linked actions, notes, edit/deactivate.
- **New contact** (`POST /contacts`); import from history (one-click "save this payee" from any approval/invoice row).
- **Backend gap:** list/get/update contact endpoints (only create exists).

### 3.10 Safety (`/dashboard/safety`)
The Payment Safety Engine, readable by a non-technical owner.
- **Policy card** (already exists in the MVP page — keep it): version, caps, currency allowlist, duplicate window, anomaly factor, rules list. **Edit policy** (versioned; changes apply to new evaluations, old verdicts keep their version stamp).
- **Blocked actions** (already exists — keep the cards): who/amount/reason/source/audit-trace expander.
- **Evaluate tester:** a sandbox form (payee, amount, currency, purpose) hitting `POST /safety/evaluate` to preview a verdict without creating anything.
- Risk-flag glossary: one line per flag (`NEW_PAYEE`, `DUPLICATE_SUSPECT`, `EMAIL_CHANGED`, `INJECTION_SIGNAL`, …) so owners understand cards.

### 3.11 Activity (`/dashboard/activity`)
The audit trail, human-readable. Chronological feed (`GET /audit/recent`) with event-type icons and filters (approvals, executions, webhooks, safety, reminders, system).
- Row click → full trace (`GET /audit/actions/:id`): the email → extraction → card → decision → execution chain with timestamps, exactly as the MVP page renders for blocked actions.
- Export button (CSV/JSON) — auditors and demo judges both love this.

### 3.12 Settings (`/dashboard/settings`)
- **Workspace:** name, timezone (drives scheduler display), currency default.
- **Connections:** Gmail / Telegram / PayPal cards with status, reconnect, and the sandbox/live toggle (PayPal).
- **Team & approvers:** approver list (Telegram ids), who can approve what; audit of approver changes.
- **Notifications:** which events ping Telegram vs dashboard-only.
- **Danger zone:** rotate session secret, revoke Gmail/PayPal grants, export all data, delete workspace.

---

## 4. Right-side AI bar

Persistent on every dashboard tab (toggle in the top bar, `⌘.` shortcut). This is the same tool-using agent that lives on Telegram — same memory (`AgentMessage`), same tools, same safety gates — in a panel, not a page.

### 4.1 What it does
- **Answers money questions** with live data: "How did October look?" (multi-window transaction search + totals), "What's my balance?", "Who hasn't paid?", "How much did I pay Ada this year?" Numbers always cite their source window ("Oct 1 – Nov 3 · 2 windows · 1 transaction").
- **Drafts actions, never executes:** "Pay Sam $5 for the test" → creates the `PAYOUT_SINGLE` draft → the approval card appears inline in the chat AND in Approvals/Telegram. Tapping Pay there (Gate 2) is still the only way money moves. Same for invoice drafts and follow-ups.
- **Reads what you drop in:** paste an email, upload a PDF/photo of a receipt or invoice (vision via `VISION_MODEL_NAME`), forward a voice note — it transcribes, extracts, and proposes the draft. Scanned PDFs with no text layer get a "send a photo instead" nudge, not a silent failure.
- **Explains itself:** every draft shows the source quote, extraction confidence, and safety verdict inline. "Why was this blocked?" answers from the real policy evaluation, naming the fired rules.

### 4.2 Context awareness
- The bar knows which tab/row is open: on an approval detail it suggests "Summarize the risk on this one"; on an invoice, "Chase this client"; on a blocked action, "Why was this blocked?"
- Suggested-prompt chips rotate by context (max 3, dismissible). No Clippy behavior: chips only, never auto-messages.
- deep-links: agent answers link to the underlying rows ("INV2-…", "approval #…", "Oct payroll") — clicking opens the drawer/tab without losing chat state.

### 4.3 Safety + honesty rules (non-negotiable)
- The bar **cannot** execute, approve, or edit-and-approve. Money buttons live on approval cards/drawers only. If asked ("just pay it"), it creates the draft and points at the card.
- Read-only tools stay read-only; scheduled/agent-task mode strips money tools entirely (already implemented server-side).
- Unknowns are stated: missing reporting scope → honest 403 explanation, not a guessed total; empty result → "0 rows in Q3", not "no data available, try later".
- Every chat-initiated draft lands in the audit trail with origin `agent-chat`, same as Telegram drafts.

### 4.4 Backend gap
No agent HTTP surface exists yet — the bar needs `POST /agent/chat` (SSE/streaming, history-aware, workspace-scoped) plus attachment upload (`multipart` → existing PDF/audio/vision ingest). Until then the bar is a designed-but-unbuilt panel.

---

## 5. Backend gaps checklist (for task.md)

| # | Gap | Needed by |
|---|-----|-----------|
| 1 | `POST /auth/signup`, `/login`, `/logout`, `GET /auth/me` | §2.1 |
| 2 | `GET /approvals` (+ filters) | §3.3 |
| 3 | Email list/get endpoints | §3.4 |
| 4 | `GET /invoices`, `GET /invoices/:id` | §3.5 |
| 5 | Contact list/get/update | §3.9 |
| 6 | `POST /agent/chat` streaming + attachment upload | §4.4 |
| 7 | Gmail/Telegram/PayPal web OAuth connect routes (CLI flows exist) | §2.2 |
| 8 | Policy update endpoint (versioned) | §3.10 |

Gaps 2–6 are scoped as task.md **Phase 9b** (plus `GET /payouts*` for §3.6). Gaps 1, 7, 8 remain unscheduled.

## 6. Build order (recommended)

1. **Dashboard shell + Approvals + Activity** — the money loop, first. Reuse the MVP page's audit-trace components.
2. **AI bar (read-only Q&A first)** — needs gap #6; drafts come after the approval UI is solid.
3. **Inbox + Contacts + Invoices + Payouts** — needs gaps #2–#5; mostly tables + drawers on existing data.
4. **Schedules + Payroll + Safety editors** — largely restyle/extend what the MVP page already renders.
5. **Landing page + onboarding** — last for the hackathon (judges see the demo video + dashboard), first for launch.
6. **Settings + auth hardening** — gates the public deploy (rotate `SESSION_SECRET`, guard MVP endpoints).
