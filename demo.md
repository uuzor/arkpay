# Demo Walk‑through – ArkPay (Production)

This document describes the **single‑click demo** you can give to any stakeholder (judge, product lead, investor, etc.). It starts at the very first screen and ends with the key safety and money‑movement moments, all using the **live production** instance at `https://app.139.84.249.48.sslip.io`.

## Quick Recap – What the demo shows

- **Secure, approval‑first money agent** – the UI proves that the LLM never calls PayPal; every action needs a human approval.
- **Tenant isolation, audit, and safety** – you can trace every request, approval, and execution back to the workspace.
- **Policy‑as‑code** – the §6 execution matrix is visible in the approval card and the audit trace; a judge can see the exact rule IDs that decided the outcome.
- **No hidden credentials** – PayPal secrets are encrypted at rest; nothing leaks in API responses.

All demo‑specific data lives in a **seeded sandbox workspace** (`DEMO_MODE=true`). No real users, no real PayPal accounts, and no real Gmail/Telegram connections – everything is synthetic and reset after each run.

---

## 1. Landing page (anonymous)

Open `https://app.139.84.249.48.sslip.io` in an incognito window.

- **Header**: ArkPay – the payments agent with a safety engine.
- **CTA button**: **Explore the live demo** (only visible when `DEMO_MODE=true`).
- **Click** → the system creates a **demo session cookie** and redirects to the overview page.

> If you are already logged in (from a previous run), simply navigate to `/` – the same overview appears; no sign‑in required.

---

## 2. Demo overview page

You now see the **workspace overview**:

- **Workspace name**: “ArkPay Hackathon – Demo” (or similar).
- **Quick stats**:
  - 2 pending approvals (see below)
  - 1 executed invoice
  - 0 connected accounts (Gmail, PayPal, Telegram) – the UI hides the sandbox probe credentials.
- **Top‑right**: a green **DEMO MODE** badge.
- **Quick actions**:
  - **Connect Gmail** (opens a consent popup – simulated)
  - **Connect PayPal** (opens the sandbox login flow – simulated)
  - **Link Telegram** (asks for a 6‑digit code – you can type `ARKPAY‑DEMO`).

> **No real OAuth** – the demo uses simulated consent flows; you can click “Connect” without any external account.

---

## 3. Pending approvals (the core demo)

The overview card shows **two pending approvals**:

1. **Pending payout request** – a Gmail‑generated request for $100 to “Acme Studio” (known payee).
2. **Pending invoice request** – a Telegram‑generated request for $250 to “NewVendor Inc.” (new payee).

Click the **view details** link on any card → opens the **approval drawer**.

### 3.1 Payout approval (known payee, under limit)

- **Request summary**: “$100 to Acme Studio (known PayPal email). Reason: design work.
- **Safety flags**:
  - None (green check) – the policy matrix cell `ALLOW_UNDER_LIMIT` passes.
- **Approval card**:
  - **Status**: “Needs confirmation” (because of the human‑approval rule).
  - **Button**: **Approve** (enabled).
- **Action**: Click **Approve** → the UI shows a success toast: “Approval recorded. You may now execute.”

### 3.2 Invoice approval (new payee, over limit)

- **Request summary**: “$250 to NewVendor Inc. (new PayPal email). Reason: consulting.
- **Safety flags**:
  - `NEW_PAYEE` (highlighted) – the matrix cell is `APPROVE` (needs manual approval).
  - `AMOUNT_ANOMALY`? – not in this case.
- **Approval card**:
  - **Status**: “Needs confirmation” with the note “Manual approval for a first‑time payee.”
  - **Button**: **Approve** (enabled).
- **Action**: Click **Approve** → toast: “Approval recorded. To execute, first re‑enter the amount for extra confirmation (demo requirement).”

> **Why the extra confirmation?** – The policy matrix for a **NEW payee on an invoice** is `APPROVE` but the demo UI forces a re‑entry of the amount to illustrate the “extra confirmation” path. You can just click **Confirm** on the modal that appears.

---

## 4. Executing the approved actions

After both approvals are recorded, the **overview card updates**:

- **Pending approvals**: 0
- **Executed invoices**: 2 (you can click to view the PayPal sandbox invoice IDs)
- **Pending payouts**: 1 (you can click to view the payout batch ID)

### 4.1 View an executed invoice

- From the overview, click the **invoices** tab (top navigation) → you see a table of the two sandbox invoices.
- Click the first row → the **invoice detail** page shows:
  - **Invoice ID** (`INV2‑…`) and **status** `SENT`.
  - **Payee**: Acme Studio, **Amount**: $100, **Due date**: 30 days.
  - **Audit trail**: one entry under “Actions” – the approval and the PayPal API call that sent the invoice (masked IDs).
  - **Preview**: a PDF‑like view with all line items.

### 4.2 View a pending payout

- In the overview, click the **pending payouts** card → you see a list of payouts.
- Click the pending payout → the **payout detail** page shows:
  - **Batch ID** (`PAYOUT‑…`) and **status** `PENDING` (sandbox holds it for verification).
  - **Recipients**: Acme Studio (the only one).
  - **Amount**: $100.
  - **Safety note**: “Payout is pending human approval – sandbox validation only.”
  - **Button**: **Execute Payout** (disabled because the sandbox PayPal account does not have Payouts enabled – the demo shows the block gracefully).

> **Demo output** – the sandbox payout will show a **blocked** status with the safety reason “Payouts not enabled on the sandbox business account – see the demo console for details.” This is a **honest limitation**; the UI labels the block clearly, and the audit log records the exact safety flag (`VENDOR_CAP_EXCEEDED` or sandbox‑specific).

---

## 5. Connections (Gmail, PayPal, Telegram)

### 5.1 Gmail connection (demo only)

- From the overview, click **Connect Gmail** → a modal asks for a Google OAuth consent screen (simulated).
- Select “Allow” → the UI shows **Gmail connected** with a green badge.
- The Gmail inbox now contains a **synthetic email** (`PAYMENT_REQUEST`) that can be used for the **demo request** (the one you approved earlier).

### 5.2 PayPal connection (demo only)

- Click **Connect PayPal** → a modal shows the sandbox merchant app ID (`APP-8W852988GP4762826`) and the list of scopes (`https://uri.paypal.com/services/invoicing`, `https://uri.paypal.com/payments/payouts`, …).
- Click **Connect** → the UI shows **PayPal connected** and the **app id** + **scope count**.
- **No real credentials** are ever displayed – only the app ID and a note “secret stored encrypted at rest.”

### 5.3 Telegram connection (demo only)

- Click **Link Telegram** → a modal shows a QR code with the text `ARKPAY-DEMO-XXXX`.
- Open a Telegram chat with the bot `@OpencommercelensBot` (provided in the demo) and type `/start` → the bot replies with the verification code.
- Paste the code into the modal → **Telegram linked**.
- The bot then sends a **demo request** (the second approval you handled) into the workspace.

> **Note** – The Telegram bot is configured in sandbox mode (`TELEGRAM_MODE=webhook`). The demo does **not** send real messages to any user – it simply logs the request into the workspace’s inbox for the UI to display.

---

## 6. Safety / Policy / Audit demonstration

- From the overview, navigate to the **Dashboard** (top nav) → you see a **list of safety events**.
- Click any row → the **Audit drawer** shows:
  - **Action ID** (e.g., `act‑abcd1234`)
  - **Event**: `SAFETY_EVALUATED` or `BLOCKED`
  - **Policy version**: `arkpay‑policy‑2026‑11‑04` (the version we just created)
  - **Verdict**: `BLOCK`, `NEEDS_CONFIRMATION`, or `ALLOW`
  - **Rule IDs**: `["M-PAYOUT-SINGLE-CHANGED", "NEVER-STALE-APPROVAL"]` – the exact matrix cell and any NEVER rule that fired
  - **Payee status**: `KNOWN`, `NEW`, or `CHANGED`
  - **Extra confirmation required** (true/false)
- The **approval drawer** also shows the **same rule IDs** – judges can see exactly why the action passed or failed.

---

## 7. End‑to‑end demo summary (what you have accomplished)

1. **Logged in** → the demo workspace auto‑loads.
2. **Explored** the overview, pending approvals, and connections.
3. **Connected** Gmail, PayPal, and Telegram (all simulated).
4. **Read two money requests** from synthetic inboxes (Gmail + Telegram).
5. **Approved** both requests using the approval UI.
6. **Verified** the safety matrix (known vs. new payee, caps, never‑rules).
7. **Viewed** the resulting PayPal sandbox invoice and payout (payout blocked in sandbox – honest, documented).
8. **Explored** the audit trail and rule IDs – the policy‑as‑code layer is visible and reproducible.
9. **Confirmed** the UI never leaks secrets (no PayPal client secret in any response).

All of this runs in a **clean, resettable sandbox** (`DEMO_MODE=true`) – you can reload the page at any time and start over.

---

## 8. Technical notes for the reviewer

- **No real OAuth** – all connections are mocked; the UI shows realistic flows without real credentials.
- **No real PayPal money** – sandbox payouts are blocked by account‑level restrictions; the demo educates the viewer about the real‑world PayPal “payouts not enabled” gate.
- **Policy as code** – `src/safety/policy.ts` contains the §6 matrix; the UI reads the latest policy via `GET /safety/policy` and shows the rule IDs in the approval card.
- **Encrypted secrets** – `PAYPAL_SECRET_ENC_KEY` is set in production `.env`; all PayPal credentials are stored as `enc:v1:` ciphertext – verified in the production DB.
- **Tenant isolation** – the demo workspace is its own tenant; no cross‑workspace leakage.
- **Audit trace** – every safety evaluation is logged to `AuditLog` with `event=SAFETY_EVALUATED` / `BLOCKED`. The rule IDs, payee status, and extra‑confirmation flags are persisted – the reviewer can click any audit row and see the exact matrix cell that decided the outcome.

---

## 9️⃣ Quick cheat‑sheet for a live demo run

```
1. Open https://app.139.84.249.48.sslip.io (incognito).
2. Click "Explore the live demo".
3. Connect Gmail / PayPal / Telegram (simulate consent).
4. Click the pending approvals → view drawer.
5. Approve both (re‑enter amount on new payee).
6. Navigate to Dashboard → inspect audit rows → see policy matrix.
7. View the generated invoice (should be SENT).
8. View the payout (should be BLOCKED in sandbox – honest).
9. Conclude: "This demo proves a human‑first payments agent with full auditability and no credential leakage."
```

You now have a complete, production‑ready demo that showcases ArkPay’s safety engine, policy as code, and end‑to‑end approval flow – all using the live production instance. 🚀

---

*Built for the PayPal AI Hackathon – Meta Global AI Developer Hackathon.*
*All code and changes are committed in the `arkpay‑public` branch; the production deployment includes the latest policy and safety updates.*