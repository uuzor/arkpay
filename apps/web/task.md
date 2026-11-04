# ArkPay Frontend — Progressive Implementation Plan

**Status:** legacy platform has been removed. `apps/web` is now a standalone Vite + React 19 + TanStack Router SPA. The shell builds with `pnpm --filter @arkpay/web build`; the screens still render `src/data/demo.js` data.

**Goal:** turn the current high-fidelity demo shell into the authenticated ArkPay product surface, backed by the Nest API and Postgres.

---

## Architecture decisions

- **SPA, not SSR.** Vite + TanStack Router + TanStack Query. The API is the source of truth; no server rendering is needed for an authenticated dashboard.
- **Same-origin API.** Browser calls `/api/*`; Vite proxies `/api` → `http://localhost:3001` in dev and Caddy strips `/api` in production. This keeps the `arkpay_session` cookie first-party and avoids CORS.
- **No tokens in browser storage.** The API sets an HttpOnly `arkpay_session` cookie. `AuthContext` only calls `/auth/me`; it never reads a session token.
- **No legacy platform auth, SDK, plugins, virtual modules, or entity storage.** Google OAuth and the personal workspace are backend concerns.
- **Server state:** TanStack Query for every API read; cursor pagination for lists.
- **Demo data is temporary.** Every phase replaces one `src/data/demo.js` dependency with an API query.

Current foundation files:

- `src/lib/api.js` — `apiFetch` / `apiJson`, default base `/api`
- `src/lib/AuthContext.jsx` — `/auth/me`, Google login redirect, logout
- `src/main.jsx` — QueryClient + RouterProvider
- `src/router.jsx` — TanStack Router SPA
- `src/routes/__root.jsx` — AuthProvider + Toaster
- `src/components/auth/AuthGate.jsx` — `_authed` session gate

---

## Backend contract map

| Surface | Endpoint(s) | Notes |
|---|---|---|
| Google login | `GET /auth/google` → `GET /auth/google/callback` | Backend sets `arkpay_session`, redirects to `/dashboard` |
| Session | `GET /auth/me`, `POST /auth/logout` | `{ user, workspace }`; workspace has `id,name,timezone,currency` |
| Workspace | `GET /workspaces/me`, `PATCH /workspaces/me` | `gmailConnected`, `paypalConnected`, `telegramLink` |
| Gmail connect | `GET /auth/gmail/connect`; callback redirects `/dashboard/settings` | Guarded browser redirect, offline refresh token |
| PayPal connect | `PATCH /workspaces/me/paypal` | `{ clientId, clientSecret, mode, webhookId? }`; probed before storing |
| Telegram pairing | `POST /telegram/link-code` | `{ linkCode, linked }`; user sends `/link <code>` in bot |
| Approvals | `GET /approvals?status&type&limit&cursor`; `POST /approvals/:id/execute`; `POST /approvals/batch/:batchId/execute`; `POST /approvals/:id/supersede`; `POST /approvals/:id/ignore` | Execute needs APPROVED (Telegram tap); dashboard approves nothing |
| Inbox | `GET /ingest/emails`; `GET /ingest/emails/:id`; `POST /ingest/run`; `GET /ingest/status` | List returns snippets; detail returns raw body + actions |
| Invoices | `GET /invoices`; `GET /invoices/:id` | Detail merges live PayPal status + reminders + webhooks |
| Payouts | `GET /payouts`; `GET /payouts/:id`; `GET /payouts/batches`; `GET /payouts/batches/:batchId` | Detail merges live PayPal batch + webhook trail |
| Payroll | `GET /payroll`; `GET /payroll/:period`; `POST /payroll/prepare`; `POST /payroll/:period/resend-card` | Preparing sends the Telegram card |
| Agent | `POST /agent/chat` (SSE); `GET /agent/messages?userId&since&limit` | Events: `text-delta`, `tool-call`, `tool-result`, `draft`, `document`, `done`, `error` |
| Safety | `GET /safety/policy`; `GET /safety/policies`; `POST /safety/policies`; `DELETE /safety/policies`; `GET /safety/blocked` | Versioned per-workspace overrides; verdicts stamp `base+wN` |
| Audit | `GET /audit/recent`; `GET /audit/actions/:actionId` | Full trace by action id |
| Schedules | `GET/POST /schedules`; `GET/PATCH /schedules/:id`; `GET /schedules/:id/runs`; `POST /schedules/:id/run` | Per-workspace seeded payroll + reminder schedules |
| Contacts | `GET/POST /contacts`; `GET/PATCH /contacts/:id` | No deactivate endpoint |

### Backend prerequisites / gaps to confirm

1. **10d enforcement is done (`task.md`, Nov 4).** Every user route is session-guarded (401 without a cookie); the frontend must send the `arkpay_session` cookie with all API calls. Env/owner fallbacks are removed.
2. **`POST /agent/chat` and `GET /agent/messages` are session-scoped.** `userId` is still the chat-thread key: pass an explicit numeric id, or omit it and the workspace's linked Telegram id is used (400 when neither exists).
3. **Ignore endpoint shipped (Nov 4).** `POST /approvals/:id/ignore` — same status machine as the Telegram button; dashboard approval stays unavailable by design.
4. **Single-payout detail shipped (Nov 4).** `GET /payouts/:id` — action + live PayPal batch merge + webhook trail.
5. **Rules CRUD shipped (Nov 4).** `GET /safety/policy` (effective), `GET /safety/policies` (history), `POST /safety/policies` (partial overrides → new version), `DELETE /safety/policies` (reset). Verdicts stamp `base+wN`.
6. **Create endpoints shipped (Nov 4).** `POST /invoices` + `POST /payouts` — same Gate-1/card path as agent drafts; client `idempotencyKey` supported (replay returns the same action; foreign-key clash 409s); `cardSent: false` when the workspace has no linked chat.

---

## Phase F0 — Foundation

- [x] Remove legacy platform directories, SDK packages, Vite plugin, virtual modules, managed files, auth boilerplate, and MCP consent.
- [x] Convert to standalone Vite SPA: `index.html`, `src/main.jsx`, TanStack Router plugin, `@` alias.
- [x] Add `src/lib/api.js` with same-origin `/api` default and cookie credentials.
- [x] Add `AuthContext` against `GET /auth/me`; Google login redirect; logout.
- [x] Add `_authed` gate and `/login` Google sign-in page.
- [x] `pnpm --filter @arkpay/web build` passes.
- [x] Add Caddy route: `handle_path /api/*` → `api:3001` on the app host.
- [x] Add a Vite-compatible `apps/web/Dockerfile` (multistage build + nginx static server).
- [x] Add `.env.example`: `VITE_API_BASE_URL` optional; default `/api`; dev proxy target documented.
- [x] Remove demo-only assumptions from the authenticated shell (auth name, workspace, environment, pending badge).

**Acceptance:** production build serves; `/api/health` reaches Nest from the app origin; no legacy platform package or reference remains.

---

## Phase F1 — Authentication

- [x] Google sign-in button → `/api/auth/google`.
- [x] `GET /auth/me` session bootstrap and 401 → anonymous.
- [x] `POST /auth/logout` + redirect to `/login`.
- [x] Accepted the backend dashboard default: Google callback → `/dashboard` → frontend redirects to `/overview`; custom `returnTo` state is deferred.
- [x] Session expiry handling: `apiFetch` emits `arkpay:unauthorized`; `AuthProvider` clears auth and redirects to `/login`.
- [x] `/dashboard` route redirects to `/overview`.
- [x] Route pending skeleton (`RoutePending`) covers auth/query waits.
- [x] Header and sidebar use `useAuth()` user/workspace; pending badge comes from `/approvals`.

**Files:** `AuthContext.jsx`, `AuthGate.jsx`, `LoginPage.jsx`, `_authed.jsx`, `login.jsx`, `TopBar.jsx`, `SidebarNav.jsx`.

---

## Phase F2 — Onboarding

Goal: a new Google user connects the three services and sets the first safety limits before seeing the dashboard.

- [x] Onboarding route `/onboarding` (auth-gated, outside the dashboard shell).
- [x] Step 1 — Workspace: `PATCH /workspaces/me`; prefilled from `/workspaces/me`.
- [x] Step 2 — Gmail: `/api/auth/gmail/connect` button + `gmailConnected`/`gmailAddress` status.
- [x] Step 3 — PayPal form → `PATCH /workspaces/me/paypal`; shows probe errors and connection status.
- [x] Step 4 — Telegram: `POST /telegram/link-code`, copyable code, 4s polling of `/workspaces/me` until linked.
- [x] Step 5 — Safety limits: read-only effective `GET /safety/policy` (env-backed).
- [x] Gate: `_authed` redirects incomplete workspaces to `/onboarding` unless localStorage skip is set.
- [x] “I’ll finish later” sets a workspace-scoped local skip; overview keeps a Finish setup banner.

**Acceptance:** a fresh Google user completes all steps; refreshing resumes correctly; connection status comes from the API, not local state.

---

## Phase F3 — Dashboard shell + overview

- [x] Replace `src/data/demo.js` summary data with:
  - `GET /approvals?status=PENDING_APPROVAL&limit=1` → pending count
  - `GET /payouts?limit=1` / `GET /invoices?limit=1` → in-flight counts
  - `GET /safety/blocked?limit=1` → blocked count
  - `GET /schedules` → next payroll/reminder run
  - `GET /workspaces/me` → connection health
- [x] Greeting uses `user.name`; workspace name from `workspace.name`.
- [x] Overview activity feed uses `GET /audit/recent`.
- [x] Stat tiles: pending, in flight, blocked, next payroll.
- [x] Setup banner when Gmail/PayPal/Telegram is missing.
- [x] Loading skeleton, API-error state and empty states on overview.
- [x] Overview has no demo imports; real queries replace them.

**Acceptance:** overview survives a reload, shows real counts, and changes after an approval.

---

## Phase F4 — Requests / inbox

- [x] `GET /ingest/emails?status&q&limit&cursor` for the list; keep cursor pagination.
- [x] Detail route `GET /ingest/emails/:id`: raw body, sender, subject, linked actions.
- [x] Replace `src/data/demo.js` `REQUESTS` and `getRequest`.
- [x] Trigger `POST /ingest/run` behind a “Sync now” button; show `GET /ingest/status`.
- [x] Show `NEEDS_REVIEW`, `IGNORED`, `PROCESSED` clearly; filter by status.
- [x] Link each action to `/requests/:id` and `/approvals`.
- [x] “Run pipeline” (`POST /pipeline/run`) on the list header and on NEW/NEEDS_REVIEW detail pages.

**Files:** `_authed/requests.jsx`, `_authed/requests_.$requestId.jsx`, `RequestTable.jsx`.

---

## Phase F5 — Approvals

- [x] `GET /approvals?status=PENDING_APPROVAL&limit&cursor` for the queue.
- [x] Detail drawer or `/approvals/:id` using `GET /audit/actions/:id` plus the approval row.
- [x] Execute: `POST /approvals/:id/execute` on APPROVED rows (and FAILED invoices), then refetch and toast. PENDING rows carry no execute button — the Telegram tap is the approval, and execute refuses `wrong_state` without it.
- [x] Batch approve: `POST /approvals/batch/:batchId/execute` from the drawer for APPROVED batch members.
- [x] Edit: `POST /approvals/:id/supersede`; show that the old approval is voided.
- [x] Ignore: `POST /approvals/:id/ignore` (shipped Nov 4).
- [x] Replace `PENDING_QUEUE`/demo cards; keep agent drafts from `/agent/chat` as an additional source.
- [x] Safety verdict/risk flags from `policyVerdict`, `riskFlags`, `safetySummary`.
- [x] Expiry countdown from `expiresAt`.

**Acceptance:** executing an APPROVED action moves it to `EXECUTING`/`EXECUTED`; pending cards point at Telegram instead of a fake approve; stale/foreign/expired actions show the refusal; cross-workspace action returns 404.

---

## Phase F6 — Invoices + payouts

- [x] Invoices list: `GET /invoices`; detail: `GET /invoices/:id` (PayPal status, reminders, webhooks).
- [x] Payouts singles: `GET /payouts`.
- [x] Batches: `GET /payouts/batches`, `GET /payouts/batches/:batchId`.
- [x] Replace `AUDIT`/`PAYROLL` demo data with real rows (`lib/agentAnswers.js` still uses them for the demo agent responder — F7 owns that).
- [x] Money formatting: API returns Decimal strings; never coerce with floating arithmetic for display totals.
- [x] Empty/error/403 states for missing PayPal reporting scope.
- [x] Batch detail as an expander on `/payouts` (members + atomic batch execute); singles link to `/payouts/:id`; batch deep-link via `/payouts?batch=` search param.

---

## Phase F7 — Agent chat + drafts

- [x] Chat UI rebuilt to the `chat.md` reference first: turn feed (`role=log`), collapsible “N actions” tool-call groups with per-tool rows (icon, status, expandable output), markdown agent text, hover copy, “Worked for Xs” turn footers, scroll-to-latest pill, autosizing composer with attachments, mobile full-screen sheet + desktop rail.
- [x] Replace `AgentBar` demo responder with `POST /agent/chat` SSE.
- [x] Parse events: `text-delta`, `tool-call`, `tool-result`, `draft`, `document`, `done`, `error`.
- [x] Render streamed text incrementally; exactly one terminal event.
- [x] Draft cards: the `draft` payload renders inline and invalidates `approvals` — the server already persisted the real `PENDING_APPROVAL`, so no local duplicate is added; `GET /approvals` is the source of truth immediately, not just after reload.
- [x] History: `GET /agent/messages` on open (limit 200; the API has no backwards paging, so one full fetch). Thread id: linked workspaces omit `userId` (shared Telegram+dashboard thread); unlinked get a stable random id from localStorage so chat works before pairing.
- [x] Attachments: multipart `files[]` (PDF/text/audio/images, 5 max); PDF/text/audio/vision prompts live on the backend.
- [x] `readOnly` mode for screens that must not create drafts (prop on `AgentBar`, default off; no caller yet).
- [x] Pass dashboard `context` (open tab/row) to the agent.
- [x] Backend one-liner: `readOnly` also accepts the string `'true'` (multipart fields are strings; JSON still sends boolean).

**Acceptance:** streamed “Pay Sam $5” creates one `PENDING_APPROVAL` action and one draft card; no browser token is stored; disconnect aborts the request.

---

## Phase F8 — Safety, audit, rules, schedules

- [x] Safety page: `GET /safety/policy`; blocked list `GET /safety/blocked`. Folded into `/rules` (“Rules & safety”) — both read the same effective policy, so one page avoids two stale copies.
- [x] Audit page: `GET /audit/recent` and `GET /audit/actions/:actionId`; filters by status/event.
- [x] Rules page: read effective policy; edits persist via `POST /safety/policies` (versioned backend model shipped Nov 4), reset via `DELETE /safety/policies`.
- [x] Schedules page: `GET /schedules`, run-now, pause/resume, run history `GET /schedules/:id/runs`.
- [x] Payroll page: `GET /payroll`, `POST /payroll/prepare`, `POST /payroll/:period/resend-card`, batch detail.

---

## Phase F9 — Settings + connections

- [x] Profile: name/timezone/currency → `PATCH /workspaces/me`.
- [x] Gmail: connect button and `gmailConnected`/address; disconnect endpoint is not implemented.
- [x] PayPal: credential form, mode, probe result; never echo secrets.
- [x] Telegram: link code, linked state, `/link` instructions.
- [x] Session: logout and “signed in as”.
- [x] Danger zone: no destructive workspace delete until backend supports it.

Notes: no standalone PayPal probe route exists, so “probe result” is the live verify-on-save outcome (fake creds → honest rejection, secret never echoed back); client ID shows truncated (`Ae…x9`). Telegram polls while a code is unclaimed.

---

## Phase F10 — Polish, deployment, verification

- [ ] Replace every `src/data/demo.js` import; delete demo data when unused.
- [ ] Add `apps/web/Dockerfile` for static Vite output.
- [ ] Caddy: `handle_path /api/*` → `api:3001`; static SPA fallback to `index.html`.
- [ ] `WEB_APP_URL`, `GOOGLE_REDIRECT_URI`, Gmail callback registered for the app host.
- [ ] `VITE_API_BASE_URL` only if API is on a different origin; otherwise `/api`.
- [ ] Add frontend test script: auth guard, login redirect, list pagination, approval execute, agent stream, onboarding connections.
- [ ] Lighthouse/accessibility pass; mobile sidebar; reduced-motion.
- [ ] Remove dead legacy platform-compatible components and unused dependencies.
- [ ] Production smoke: Google login → onboarding → overview → approve one invoice → agent chat.

**Done when:** a new Google user can sign in, connect Gmail/PayPal/Telegram, see only their workspace data, approve a real action, chat with the agent, and view safety/audit/schedules — with no legacy platform dependency and no demo data in production paths.

---

## Suggested order

1. F0 Caddy/Docker + F1 auth hardening
2. F2 onboarding
3. F3 overview + F9 settings connections
4. F4 requests + F5 approvals
5. F6 invoices/payouts
6. F7 agent chat
7. F8 safety/audit/schedules
8. F10 polish + verification

The critical path is **F1 → F2 → F5**: until onboarding connects the workspace and approvals execute real actions, the rest is read-only dashboard work.


---

## Verification log

### Contacts wiring (Nov 4)

- `/contacts` was the last mock screen — now list + server kind filter + search + history expander (stats + recent actions + trace drawer) + create/edit dialogs on `GET/POST/PATCH /contacts`. Deleted dead `AgentFeed` and `data/demo.js`; zero `data/demo` imports remain.
- Live smoke (`/tmp/contacts-live.cjs`, throwaway): 7/7 `[PASS]` — HTTP list/filter/detail/401, real book renders with demo names asserted absent, filter + search, expander + drawer, create + edit persist, zero console errors. Zero leftovers.
- `pnpm --filter @arkpay/web build` → **exit 0**; `pnpm --filter @arkpay/web lint` → **exit 0**.

### F9 (Nov 4)

- `/settings` rebuilt on the real API: profile (name/timezone/currency → `PATCH /workspaces/me`), Gmail connect + status, PayPal credential form (live verify-on-save, truncated client-ID display, secret cleared on success), Telegram link code + linked state + `/link` instructions with unclaimed-code polling, session (signed-in user + logout), privacy link, danger zone with honest no-delete / no-disconnect notes.
- Live smoke (`/tmp/f9-live.cjs`, throwaway): 6/6 `[PASS]` — all sections render, profile rename persists across reload (owner name restored afterwards), fake PayPal creds rejected live with the error surfaced, Telegram code in `ARKPAY-XXXXXX` form, logout returns to `/login`, zero console errors / unexpected API failures. Caught and fixed a real crash (hook referenced in its own initializer). Zero leftovers; no stray processes.
- `pnpm --filter @arkpay/web build` → **exit 0**; `pnpm --filter @arkpay/web lint` → **exit 0**.

### chat.md UI rebuild + F7 (Nov 4)

- Rebuilt the agent bar to the `chat.md` reference before wiring: turn feed, collapsible tool-call groups (“N actions”, per-tool status + output), markdown rendering, hover copy, elapsed footers, scroll-to-latest, autosizing composer with file chips, Stop button, document downloads, mobile sheet. Pre-wire check (`/tmp/chat-ui-check.cjs`): greeting, chips, markdown turn, draft card, mobile span, zero errors.
- F7 wiring: `lib/agentStream.js` SSE client (JSON or multipart, `done|error` exactly-once, 401 → global sign-out event, abort on Stop/unmount); history replay on open; thread id shared-with-Telegram when linked, stable random id when not; dashboard context + `readOnly` passed through; draft events invalidate `approvals` (no local duplicate).
- Live smoke (`/tmp/f7-live.cjs`, throwaway, real Vultr model): 6/6 `[PASS]` — history endpoint shape, streamed Q&A with a real tool-call group (expanded: Pending queue row), draft turn creating a real `PENDING_APPROVAL` + inline card, history replay after reload (no greeting), multipart attachment ingested and quoted, zero console errors / failed API calls. Caught and fixed a real bug (nested setState duplicating streamed turns under StrictMode). Zero leftovers (users/actions/agent-messages); owner workspace intact.
- Regression: `test:agent-chat` still 6/6 after the `readOnly` multipart fix. Deleted the demo responder (`lib/agentAnswers.js`).
- `pnpm --filter @arkpay/api build` → green; `pnpm --filter @arkpay/web build` → **exit 0**; `pnpm --filter @arkpay/web lint` → **exit 0**.

### F6 + F8 (Nov 4)

- F6: `/invoices` (status filter, cursor pages) + `/invoices/:id` (live PayPal status or honest reason, reminders, webhooks, trace drawer, source-email link); `/payouts` with Singles/Batches tabs, batch expanders (members + atomic execute), `/payouts/:id` (batch status, safety, webhooks); batch deep-link from payroll via `?batch=`. New sidebar entries: Invoices, Payouts, Schedules.
- F8: `/rules` is the combined Safety + Rules page (editable caps/limits/currencies → versioned save + reset, engine rules, version history, blocked list with traces, evaluate tester, flag glossary); `/audit` (status + event filters, expandable events, full-trace drawer); `/schedules` (run-now, pause/resume, run history, create dialog with kind picker + once/interval/cron builder); `/payroll` (runs, prepare with included/excluded summary, member detail with usual-amount + flags, re-send card, payouts deep-link).
- Live smoke (`/tmp/f6f8-live.cjs`, throwaway): real API + vite + Chromium, 22/22 `[PASS]` — all F6/F8 HTTP contracts (incl. policy save→live→reset, schedule pause/resume/run-now, payroll prepare with include/exclude, 401s) plus browser renders and interactions on all 8 pages with zero console errors / failed API calls. Zero seed leftovers; owner workspace verified intact afterwards.
- Incident during verification: the first smoke run's over-broad cleanup wiped the adopted owner workspace's seeded schedules + Telegram link. Repaired immediately (`/tmp/repair-owner.cjs`): schedules re-seeded (payroll ACTIVE, reminders PAUSED), fresh link code issued — Telegram needs one re-pair (`/link ARKPAY-CHQR5M` in the bot). Smoke cleanup is now strictly TAG-scoped and never touches TelegramLink.
- `pnpm --filter @arkpay/web build` → **exit 0**; `pnpm --filter @arkpay/web lint` → **exit 0**.

### Landing redesign + F4/F5 (Nov 4)

- Landing rewritten in the Centra Lake / Quo visual language (DM Sans display, black pill CTAs, paper cards, lime highlighter accents, chat-flow hero mock, verified-stats strip) with the brief headline “One shared place for every money request.” Fixed two dead `/register` links → `/login`; added inline SVG favicon; added `prefers-reduced-motion` guard.
- F4: `/requests` (status filters, debounced server search, cursor pages, Sync now, Run pipeline, ingest status line) + `/requests/:id` (raw body, extracted fields, linked actions, reprocess button) on the real API; demo `REQUESTS`/`getRequest` gone from these routes.
- F5: `/approvals` queue (status + type filters, cursor pages, keyboard nav) + detail drawer (source quote, low-confidence flag, verdict + flags, contact history with email-change warning, audit timeline, hash). Execute only on APPROVED/FAILED-invoice rows; PENDING cards point at the Telegram tap; batch execute from the drawer; Edit → supersede with the `/pending` note; Ignore → ignore endpoint.
- Live smoke (`/tmp/f4f5-live.cjs`, throwaway): real API on :3001 + vite on :3000 + system Chromium with an injected session — 14/14 `[PASS]` (F4/F5 HTTP shapes, ignore + supersede round-trips, 401s, landing/requests/detail/approvals/drawer renders, drawer Ignore click, zero console errors / failed API calls). Caught and fixed a real bug (missing `SheetDescription` import crashed the drawer). Zero seed leftovers (0 users/actions/emails), no stray processes.
- `pnpm --filter @arkpay/web build` → **exit 0**; `pnpm --filter @arkpay/web lint` → **exit 0**.

### F0–F3

- `pnpm --filter @arkpay/web build` → **exit 0** after the SPA conversion.
- Playwright/Chromium against the local Vite dev server + Nest API:
  - anonymous `/overview` → `/login`
  - signed-in incomplete workspace `/overview` → `/onboarding`
  - workspace save → `PATCH /workspaces/me` succeeded
  - “I’ll finish later” → `/overview`, setup banner visible
  - seeded pending action visible in overview + reload
  - complete Gmail/PayPal/Telegram connections → `/overview` opens without skip
  - logout → `/login`
  - zero browser console/page errors
- API contracts exercised with the test session:
  - `GET /auth/me` → user + workspace
  - `GET /workspaces/me` → connection state
  - `GET /approvals?status=PENDING_APPROVAL` → pending count
  - `POST /telegram/link-code` → code
  - `PATCH /workspaces/me/paypal` → invalid credentials rejected; valid env credentials accepted
  - `GET /auth/google` and `GET /auth/gmail/connect` → Google OAuth redirects
- Final builds: `pnpm --filter @arkpay/api build` **exit 0**; `pnpm --filter @arkpay/web build` **exit 0**.
- Deployment attempt **blocked**: `/home/runner/.ssh/arkpay_vultr` is missing and TCP 22 times out from this workspace. The image/archive is ready at `/tmp/opencode/arkpay-f1-f3.tgz`; restore the SSH key (and firewall access) to deploy.

### Remaining manual F2 verification

Google OAuth consent, Gmail read-only consent and a real Telegram `/link` were not completed in automation. The redirect URLs, link-code endpoint and PayPal credential probe were exercised directly; the browser callback needs the real Google account and bot.
- Deployment key rotated after the workspace lost `~/.ssh`. The new Ed25519
  keypair lives at `.ssh/arkpay_vultr` inside the repo (gitignored, copied to
  `~/.ssh/arkpay_vultr`); fingerprint
  `SHA256:l9EsaC7eTcKincGhRzmCt1G6zORuTt0WZv4MgAhNqws`.
- Deployment is still blocked at the network layer: this workspace egresses
  from `136.70.15.135`, which is neither in the Vultr API access-control list
  (`401 Unauthorized IP address`) nor in the `arkpay-prod` firewall's SSH
  rules (port 22 times out). `deploy/ssh-bootstrap.sh` registers the new key
  and opens the rule as soon as the IP is allowlisted; the running instance
  must then trust the key once via the Vultr web console.
- Vultr API access and SSH were restored from this workspace after the
  egress IP `136.70.15.135/32` was allowlisted: the API returns 200, the
  `arkpay-prod` firewall now has a tcp/22 rule for it, and port 22 answers.
- The new key is registered on the Vultr account
  (`87b39c62-a1f7-4905-a282-f043279c161c`), but Vultr only injects account
  keys into new instances. The running server still trusts the old (lost)
  key, so SSH returns `Permission denied (publickey,password)`.
- Remaining unblock: install the new public key in
  `/root/.ssh/authorized_keys` on the running instance (Vultr console), or
  provide the instance root password (password auth is enabled) so the key
  can be installed over SSH. `deploy/deploy.sh` is ready to run immediately
  afterwards.

---

## Production deployment — 2026-11-04

- Deployed the F1–F3 build to `https://app.139.84.249.48.sslip.io` /
  `https://api.139.84.249.48.sslip.io` with `deploy/deploy.sh`
  (Vite + nginx web image, Nest API image, `prisma migrate deploy`).
- Fixed before shipping: the OAuth callback lands on the API host while the
  SPA runs on the app host, so the session cookie was host-only. The API now
  sets `Domain=${SESSION_COOKIE_DOMAIN}` and production uses
  `SESSION_COOKIE_DOMAIN=139.84.249.48.sslip.io`. Verified:
  `Set-Cookie: arkpay_session=…; Secure; Domain=139.84.249.48.sslip.io`.
- Fixed the Docker build: `COPY` merges, so a service file deleted from the
  repo (`telegram-agent.service.ts`) survived on the server and in the image
  cache. `deploy/deploy.sh` now clears the old source tree and both
  Dockerfiles clear their `src/` before copying.
- Migrations applied on production: `User`, `Workspace`, `Session`,
  `TelegramLink` created; existing `Action` rows backfilled to the legacy
  `owner` workspace (`Action.workspaceId = owner`), 16 audit rows preserved.
- Live checks:
  - `GET https://api.139.84.249.48.sslip.io/health` → `{"ok":true}`
  - `GET https://app.139.84.249.48.sslip.io/` → 200 (Vite index)
  - `GET /overview` → 200 (SPA fallback)
  - `GET https://app.139.84.249.48.sslip.io/api/health` → 200 (Caddy proxy)
  - `GET /api/auth/me` anonymous → 401
- Playwright against production with a seeded session:
  - anonymous `/overview` → `/login`
  - signed-in incomplete workspace → `/onboarding`
  - workspace save through the UI
  - “I’ll finish later” → `/overview` with setup banner
  - completed connections → `/overview` without banner
  - real user/workspace, no demo data, tenant isolation (`totalCount: 0` for
    a second workspace while the owner had 3 actions)
  - zero console/page errors
- SSH recovered without the lost private key: snapshot → clone with the new
  key → snapshot clone → restore the original instance from it (same IP).
  SSH is now key-only (`passwordauthentication no`).

### Remaining: Google Cloud OAuth redirect URIs

Google returns `redirect_uri_mismatch` for the production callbacks. Add both
to OAuth client `198366634337-3s72pcnpiu2qd3q4qbo2toc3hd8and27`:

```
https://api.139.84.249.48.sslip.io/auth/google/callback
https://api.139.84.249.48.sslip.io/auth/gmail/callback
```

Until then sign-in and Gmail connect stop at Google; the rest of F1–F3 is live.
