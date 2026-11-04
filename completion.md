# ArkPay — Meta Global AI Developer Hackathon Plan (DO THIS FIRST)

**Submission:** Meta Global AI Developer Hackathon, Indie track — *Build for Your World*
**Deadline:** **Wed 4 Nov 2026, 9:00 PM ET** (Thu 01:00 UTC) — ~13.5h left as of 7:25am ET
**Submit at:** CV platform (one submission, list all contributors); repo + video links must work logged-out
**Frame:** freelancers drowning in money-request chaos, solved with Meta's models — an AI payments agent that *can't* steal your money (safety engine). State Standard tier used deliberately — financial data never trains models.
**Rules that matter:** repo must be public; demo/video may show ONLY work built Oct 27–Nov 4 (our git log: all ArkPay commits Nov 3–4 ✅ — say this in the submission); 3-min video is a primary judging artifact and shown live in finals.
**Stage 1 gate:** must reasonably use Meta Model API and/or open-weight models → the model swap below is the entry ticket, not polish.

## M0. Meta model plan

| Use | Model | How |
|---|---|---|
| Agent reasoning + extraction | `muse-spark-1.3` | `META_MODEL_URL=https://api.meta.ai/v1` + key + model id; re-run all gates |
| Agent reasoning | `muse-wonder-1.0` | `AGENT_MODEL_NAME` (new, falls back to `META_MODEL_NAME`); verified 6/6 agent-chat + 20/20 fixtures |
| Voice notes | `muse-voice-transcribe-1.0` | Replace Whisper in `transcription.service.ts` (check dev.meta.ai endpoint shape) |
| Receipt photos | Spark multimodal | Replace Vultr vision, likely config-level (OpenAI-style image content) |
| Explicitly skipped | Image 1.0, SAM 3.1 | No natural fit — forced usage reads as gaming |
| Explicitly skipped | Contributor tiers | Trains on our data — wrong for a money app |

## M1. Ordered task list (tonight)

- [x] Swap provider to Meta (Spark 1.3) via `.env`; re-run connections probe — 5/5 green
- [x] Re-run 20-fixture extraction gate — **20/20 on Spark 1.3** (was 19/20 on DeepSeek; fix-10 flake gone). Fix: raised `MAX_TOKENS` 800→4000 in extraction + vision providers (Spark reasons before answering; 800 starved the visible completion → `finish_reason=length`, null content)
- [x] Re-run `test:agent-chat` 6/6 on Meta — ALL GREEN
- [x] Voice → Muse Voice Transcribe — **PASS end to end**: real speech OGG (37KB "Pay Daniel Eze $780 for the paper supply") → `TranscriptionService` (ffmpeg OGG→WAV 24kHz mono, multipart `request` JSON mode DIARIZATION + `audio` WAV to `/asr/transcribe`) → `"Pay Daniel E $780 for the paper supply"` in 1.5s. Notes: TRANSCRIBE mode 400s, DIARIZATION works; WAV required. Live Telegram voice-note test still needs re-pair + redeploy
- [x] Vision → Spark multimodal — **PASS end to end**: generated receipt PNG (ACME HOSTING / Invoice 1042 / 2026-10-15 / TOTAL $450.00) → `VisionService.describeImage` with `VISION_MODEL_NAME=muse-spark-1.3` → exact transcription in 5.7s. `muse-wonder-1.0` also transcribes exactly (stretch candidate). `.env`, `.env.example` updated; `deploy/vultr/.env.prod` vision var updated, Meta URL/key/model at redeploy step
- [x] (Stretch) Wonder for agent loop — **ADOPTED**: 20/20 fixtures + 6/6 agent-chat on `muse-wonder-1.0`; split wired via new `AGENT_MODEL_NAME` (Spark 1.3 stays on extraction + vision); negative control (bogus model → gate FAIL) proves the loop reads the new var
- [x] Redeploy Vultr API + web on Meta env — **DONE + VERIFIED**: `.env.prod` → Meta URL/key, Spark extraction/vision, Wonder agent, Voice Transcribe; added `ffmpeg` to API Dockerfile; `GET /health` ok, web 200, webhook re-registered, ffmpeg in container; in-container `VisionService` check → exact receipt transcription via `muse-spark-1.3` in 8.4s
- [x] Rename GitHub repo `hyperlit` → `arkpay`; confirm public + LICENSE visible logged-out; push — **DONE**: owner created fresh public `uuzor/arkpay`; pushed `arkpay-public` → `main` (2 commits: 9863500 base + 8549b00 demo mode). Verified logged-out: repo 200, LICENSE 200, `"private": false`. Old `hyperlit` untouched (stale 2025 commit only — never push ArkPay history there; transcripts contain secrets)
- [ ] Claim $150 Meta credits via form (card on file) so judging (Nov 5–8) can't get throttled
- [x] Re-pair Telegram — **DONE**: `ARKPAY-BCCMPK` linked at 10:24 UTC (chat 7614171263); webhook set, 0 pending; link-check ping delivered (msg 97). User to reply `/status` to exercise the agent loop live
- [ ] Write video script (~2:45) + record + upload (start early — long pole) — **SCRIPT DONE** (`video-script.md`, 7 beats per M2, all demo inputs verified); record + upload pending (needs re-paired Telegram + demo workspace)
- [ ] Submission form: repo, video, contributors, "built Oct 27–Nov 4" statement
- [ ] Final check 1h before deadline: links logged-out, demo workspace works, access stays up through Nov 8+

## M2. Video beats (~2:45)

| Time | Beat | Visual |
|---|---|---|
| 0:00 | Problem: money requests drown freelancers; agents need guardrails | Title card (name the Muse models) |
| 0:20 | Email arrives → Spark extracts payee/amount/purpose | Requests + extraction |
| 0:50 | Telegram approval card → tap → invoice SENT in sandbox | Phone + PayPal status |
| 1:25 | Fraud email blocked by the safety engine | Blocked card + flags |
| 1:50 | Voice note → payout draft; receipt photo → invoice draft | Transcribe + vision (name the models) |
| 2:20 | Dashboard: audit trail, rules, schedules | Audit drawer |
| 2:40 | Repo + demo URL end card | Links |

## M3. Do NOT do today

Partner onboarding, Muse Image/SAM, new features, Contributor tier, PayPal-hackathon work (deadline Nov 12 — resumes after this submission).

---

# ArkPay — PayPal AI Hackathon Completion Tracker (RESUMES AFTER META SUBMISSION)

**Submission:** PayPal AI Hackathon — *Build What’s Next with PayPal and AI*
**Deadline:** **Thu 12 Nov 2026, 20:00 UTC** (12:00 PT)
**Winners:** on/around 21 Dec 2026
**Rule:** project must stay free to access until **15 Dec 2026, 16:00 UTC** (judging ends)

---

## Status at a glance

| Area | State | Notes |
|---|---|---|
| Product (F1–F3) | ✅ Live | Auth, onboarding, overview, requests, approvals, audit, settings on real APIs |
| Google sign-in | ✅ Live | Two real accounts signed up in production |
| PayPal encryption | ✅ Live | AES-256-GCM at rest; `enc:v1:` verified in production DB |
| Sandbox invoice loop | ✅ Works | Per-workspace merchant app |
| Sandbox payouts | ⚠️ Blocked | Batch returns `DENIED/FAILED` despite $5,000 balance |
| Partner onboarding | ⏸ Parked | `INVOICE_READ_WRITE` + `PAYOUTS` return 422 on platform app |
| Public repo | ⬜ Not ready | 113 uncommitted files; tracked transcripts contain secrets |
| Judge demo access | ⬜ Not built | Onboarding gate blocks judges |
| 3-min video | ⬜ Not started | Required, public YouTube |
| Devpost submission | ⬜ Not started | Text + links |

---

## 1. Submission requirements (must all be true)

- [ ] Public open-source repository (GitHub/GitLab) with working code
- [ ] Working demo or clear setup instructions
- [ ] Public YouTube video **under 3 minutes**
- [ ] Text description on Devpost
- [ ] List of AI tools used
- [ ] Testing instructions / test logins for judges
- [ ] Demo + test access kept alive until **15 Dec 2026**
- [ ] Meaningful use of **PayPal** and **AI**
- [ ] Project created or significantly advanced between **1 Oct – 12 Nov 2026**
- [ ] No third-party trademarks/copyrighted assets without permission

---

## 2. Engineering tasks

### 2.1 Judge access (highest ROI)

- [x] Add `DEMO_MODE` env flag (server + web) — server enforces; web reads `GET /auth/mode`
- [x] Backend: `POST /auth/demo` creates a session for a seeded demo workspace (`demo.service.ts`, idempotent seeding)
- [x] Seed data: 5 pending approvals (3 invoice + 2 payout), 2 executed invoices, 1 blocked fraud payout, audit rows, schedules, contacts, 4 emails, Telegram link code
- [x] Demo is **invoice-live, payout-read-only** (deviation from read-only plan, agreed with owner): invoices execute against the sandbox; payouts refuse with `demo_readonly` + audit; banner labels it “sandbox demo”
- [x] Login page: “Explore the live demo” button (only when `DEMO_MODE=true`)
- [x] Rate-limit demo session creation (10/hr/IP, in-memory); no PII (fixed `judge@arkpay.demo`, example.com seeds)
- [x] Verify: demo login → isDemo session → approvals → approve → executed `INV2-4D37-GKDU-GSTG-7MQU` live in prod; payout refused `demo_readonly`; profile/PayPal edits refused; `test:demo` 8/8 ALL GREEN (incl. live `INV2-BM9Z-4PD2-GVCA-E2TW`)
- [x] Add demo link + instructions to README (Devpost = PayPal phase, after Meta submission)

### 2.2 Demo path verification

- [ ] Login → onboarding → workspace save
- [ ] Gmail connect (or skip) → PayPal connect → Telegram link (or skip)
- [ ] Requests list → request detail
- [ ] Approvals → card → drawer → approve → executed
- [ ] Agent chat → “Send invoice to …” → draft card
- [ ] Audit → trace one action end to end
- [ ] Safety/Rules → limits + blocked list
- [ ] Settings → connections + logout
- [ ] Zero console errors on each route
- [ ] Mobile viewport pass (sidebar, cards)

### 2.3 Money movement

- [ ] Create + execute one real **sandbox invoice** (record `INV2-…`)
- [ ] Show invoice status in UI (approval/audit if no invoices page)
- [ ] Payout: try sandbox business account in `sandbox.paypal.com` UI
  - [ ] If UI payout works, retry API with a personal sandbox recipient
  - [ ] If UI payout is blocked, keep payout as “approval + policy” and label the execution gate honestly
- [ ] Capture evidence for README/video (IDs, statuses, timestamps)

### 2.4 Security / hygiene

- [ ] Rotate secrets exposed in tracked `conversation-*.txt`:
  - [ ] PayPal merchant app secret
  - [ ] Vultr API key
  - [ ] Telegram bot token
  - [ ] `SESSION_SECRET` (invalidates sessions)
  - [ ] Gmail refresh token (reconnect)
- [ ] Delete `conversation-*.txt` from the working tree
- [ ] Create a **fresh repo** (no old history) — do not publish the current git history
- [ ] Verify `.env`, `.ssh/`, `*.log`, `conversation-*.txt` are absent from the public tree
- [ ] `git grep` for `sk-`, `client_secret`, `BEGIN OPENSSH`, `VULTR_API_KEY` returns nothing
- [ ] Keep `PAYPAL_SECRET_ENC_KEY` out of the repo; document rotation

### 2.5 Repo quality

- [ ] README: what it is, screenshots, architecture diagram, PayPal + AI stack
- [ ] Setup: env vars, `pnpm install`, `pnpm --filter @arkpay/api build`, web build
- [ ] Test instructions: demo link, sandbox credentials if shared, expected flow
- [ ] `LICENSE` (already present — confirm)
- [ ] `apps/web/task.md` and `task.md` included or trimmed (no secrets)
- [ ] CI or at least a `test` command that passes
- [ ] Remove stale artifacts: `dist`, `.local`, `node_modules`, `*.tgz`, backups

---

## 3. Three-minute demo video

Target **2:45–2:55**, public YouTube, 1080p, clear audio.

| Time | Beat | Visual |
|---|---|---|
| 0:00 | Problem: invoices/payouts eat hours; agents need guardrails | Landing / title card |
| 0:15 | Sign in + workspace + connections | Google → onboarding → overview |
| 0:35 | Inbox request → agent extracts payee/amount/purpose | Requests + agent chat |
| 1:00 | Draft card + policy verdict + risk flags | Approval card |
| 1:20 | One approval → PayPal sandbox invoice | Executing → executed |
| 1:40 | Payout draft → cap/block or sandbox payout | Approval + safety |
| 2:10 | Audit trace, idempotency, tenant isolation | Audit drawer |
| 2:30 | Impact: freelancers/micro-businesses; next: live Payouts + partner onboarding | Closing |
| 2:50 | Repo + demo URL | End card |

- [ ] Write script + shot list
- [ ] Record clean take (no debug/devtools, no secrets on screen)
- [ ] Blur/redact account emails if needed
- [ ] Upload unlisted/public YouTube
- [ ] Add captions
- [ ] Verify length < 3:00

---

## 4. Devpost submission copy

- [ ] Project name + tagline
- [ ] Inspiration
- [ ] What it does
- [ ] How we built it (PayPal APIs + Agent Toolkit + AI SDK + LLM)
- [ ] Challenges (sandbox Payouts gate, OAuth cookie domain, tenant isolation)
- [ ] Accomplishments
- [ ] What we learned
- [ ] What’s next (partner onboarding, live Payouts)
- [ ] Built with (tags)
- [ ] AI tools used
- [ ] Repo URL
- [ ] Video URL
- [ ] Demo URL + test instructions
- [ ] Screenshots (4–6)
- [ ] Submit early (target **10–11 Nov**)

### Positioning

> **ArkPay is the payments agent with a safety engine: it reads a money request from email or chat, drafts the PayPal invoice or payout, and waits for one approval before executing — with policy caps, risk checks, idempotency, and a full audit trail.**

Prizes to target: **Best Use of PayPal + AI**, **Best Use of Agentic Commerce**, **Most Impactful**, **Best Demo Delivery**.

---

## 5. Dates

| Date | Task |
|---|---|
| Nov 4 (today) | Freeze features; clean repo; start demo mode |
| Nov 5 | Finish demo mode + seed; verify flows |
| Nov 6 | Record video; capture screenshots |
| Nov 7 | README + Devpost copy |
| Nov 8 | Payout attempt / fixes; polish |
| Nov 9 | Feature freeze; full regression |
| Nov 10 | Submit (target) |
| Nov 11 | Buffer / fix submission issues |
| Nov 12, 20:00 UTC | **Hard deadline** |
| Dec 15, 16:00 UTC | Keep demo/test access alive |

---

## 6. Known blockers / risks

| Risk | Impact | Mitigation |
|---|---|---|
| Payouts `DENIED` in sandbox | Weak “money out” demo | Show approval + policy; try sandbox UI; label honestly |
| Judge cannot connect PayPal | Can’t see product | Demo mode + seeded workspace |
| Repo history leaks secrets | Disqualification / incident | Fresh repo, no history, rotate secrets |
| Google OAuth redirect URIs | Login fails | Already added; keep client config stable |
| `INVOICE_READ_WRITE` / `PAYOUTS` 422 | Partner onboarding unusable | Park; don’t block submission |
| Time (8 days) | Incomplete submission | Submit early; no new features after Nov 9 |

---

## 7. Verification log

Append evidence here as tasks complete.

- 2026-11-04: F1–F3 deployed; `/health` 200; `/api/health` 200; Google login live (2 real users).
- 2026-11-04: PayPal secret stored as `enc:v1:`; decrypt check `true`; no secret in API responses.
- 2026-11-04: Sandbox invoice path works with per-workspace merchant app.
- 2026-11-04: Sandbox payout batch `B2DDW8EA3D5VN` → `DENIED/FAILED`; sender balance $5,000.
- 2026-11-04: Platform app Partner Referrals: `PAYMENT/REFUND/ACCESS_MERCHANT_INFORMATION` 201; `INVOICE_READ_WRITE`/`PAYOUTS` 422.
- 2026-11-04: Platform merchant ID `SKPYWVPERFT8U`; BN code `FLAVORsb-sup5l53709937_MP` set.
