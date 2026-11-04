# Demo Narration Script – ArkPay Live Production Demo

*(Read these cue lines aloud as you navigate the UI. Replace `<YOUR‑URL>` with the actual demo host.)*

---

## 0. Opening Hook (30 seconds)

> **Narrator:** "Welcome to ArkPay – the world’s first payments agent that *can’t steal your money*. We built a secure, AI‑powered assistant that drafts PayPal invoices and payouts, but every single one waits for a human approval. Let’s see how it works live – no real credentials, all sandbox, all auditable."

- Point to the **Explore the live demo** button.
- Click it.

---

## 1. Landing page (10 seconds)

> **Narrator:** "We’re now looking at the ArkPay landing page. You’re in an incognito window, so there’s no existing session – perfect for a clean demo. Notice the *Explore the live demo* CTA; that’s our way of ensuring anyone can try the product without signing up."

- Highlight the button.

---

## 2. Demo workspace overview (30 seconds)

> **Narrator:** "Welcome to the ArkPay demo workspace! The top‑right badge says **DEMO MODE** – that tells us we’re using a seeded sandbox, so no real Gmail/PayPal connections. The overview shows two pending approvals, one executed invoice, and zero connected accounts – just the synthetic data we’ll work with."

- Circle the two pending approvals.
- Explain: "These are money requests that arrived via synthetic inboxes – one from Gmail (known payee) and one from Telegram (new payee). We’ll approve both and see how the safety engine decides each."

---

## 3. Dive into an approval (45 seconds)

### 3.1 Payout approval (known payee)

> **Narrator:** "Let’s start with the payout request – $100 to Acme Studio. Acme is a known payee (we have a record), and the amount is under our auto‑approve limit of $0 (because we require manual approval for every payout – that’s the core safety rule). The safety flags show no warnings, so the policy matrix cell says **ALLOW_UNDER_LIMIT**. The approval card says ‘Needs confirmation’ – we must approve manually before any money moves."

- Click the approval card → open drawer.
- Point to the **Approve** button.
- Narrate: "We’re approving this payout. Notice the audit log will later record exactly which rule IDs decided this – we’ll see them in the dashboard."

### 3.2 Invoice approval (new payee)

> **Narrator:** "Now the invoice request – $250 to NewVendor Inc., a brand‑new payee. Because it’s a new payee, the policy matrix moves to **APPROVE** (manual approval). The UI highlights a warning: ‘Manual approval for a first‑time payee.’ Also, because we require extra confirmation for new payees, the system asks us to re‑enter the amount. That extra step is a built‑in guard – even if the model suggests a payment, a human must double‑check the amount."

- Click the invoice approval card.
- Explain the extra confirmation modal.
- Approve.

---

## 4. Executing the actions (30 seconds)

> **Narrator:** "Both approvals are recorded. The overview now shows two executed invoices and one pending payout. Let’s look at the invoice details."

- Click the invoice tab.
- Show the invoice ID and status `SENT`.
- Narrate: "Great – the invoice is sent in the PayPal sandbox. Notice the audit trail under ‘Actions’ – it logged the approval and the PayPal API call (masked). This proves the whole chain: email → extraction → approval → PayPal send."

> **Narrator:** “Now let’s look at the payout. It’s pending because the sandbox business account doesn’t have payouts enabled – a real‑world gate that the UI surfaces honestly. The safety engine tells us exactly why: 'Payouts not enabled on the sandbox business account. See console for details.' This is a transparent limitation, not a hidden bug."

---

## 5. Connecting services (30 seconds)

> **Narrator:** "Let’s see how connections work. We’ll connect Gmail, PayPal, and Telegram – all simulated for the demo."

### 5.1 Gmail

- Click **Connect Gmail**.
- Narrate: "The modal asks for Google consent – we’ll simulate that by clicking 'Allow'. The UI now shows Gmail is connected and lists the synthetic inbox. This inbox will be the source of future money requests."

### 5.2 PayPal

- Click **Connect PayPal**.
- Narrate: "Here we see the sandbox platform app ID and the scopes we have (invoicing, payouts, etc.). No secret keys are ever shown – everything is encrypted at rest. This transparency is crucial: the product protects your credentials while still using the APIs you need."

### 5.3 Telegram

- Click **Link Telegram**.
- Narrate: “Scan the QR code with the demo bot (instructions on screen). The bot sends a synthetic request, which instantly appears in our workspace as a new approval. This shows how any chat platform can feed the agent – the UI treats every incoming request the same, applying the same safety engine."

---

## 6. Safety & Policy demonstration (45 seconds)

> **Narrator:** “The heart of ArkPay is the **Safety Engine**. Let’s explore the dashboard to see exactly how the policy decided each action."

- Navigate to **Dashboard**.
- Click the first **SAFETY_EVALUATED** row.
- Narrate: "Notice the policy version – `arkpay‑policy‑2026‑11‑04`. The rule IDs show the exact matrix cell (`M-PAYOUT-SINGLE-KNOWN`) and any NEVER rules that fired (`NEVER‑EXCEED‑CAPS`). The payee status is `KNOWN`. This proves the decision is data‑driven, not a black box."

- Click a **BLOCKED** row (if any).
- Narrate: “Here we see a blocked request – the rule IDs explain why. In the demo we blocked a changed‑payee payout because the policy says that’s a hard block. This protects you from account‑takeover scenarios."

---

## 7. Closing the demo (30 seconds)

> **Narrator:** “We’ve now walked through the complete flow: landing, connecting services, extracting requests, applying policy, approving, executing, and auditing. Every step is transparent, every decision is logged, and no secret ever leaves the encrypted store.

- **Key takeaways**:
  1. **Human‑first** – no money moves without approval.
  2. **Policy as code** – you can see exactly which rules decided each action.
  3. **Zero credential leakage** – all secrets are encrypted at rest.
  4. **Multichannel ingestion** – Gmail, Telegram, chat, email – all funnel into the same safety engine.
  5. **Full audit trail** – from request to PayPal API call, everything is logged and traceable.

- **Innovation**: The integration of AI (Muse Spark) with a deterministic safety engine, encrypted credentials, and tenant‑isolated execution – all in a single Vite SPA that talks to the same origin `/api`. This is the future of safe, agentic commerce.

> **Narrator:** "Thank you for watching. The demo shows how ArkPay makes it possible to let an AI assistant draft payments without giving it the power to execute – all backed by production‑grade security and transparent policy."

---

## Cue‑sheet for presentation slides (optional)

| Slide | Title | Visual Cue |
|-------|-------|------------|
| 1 | Landing | Show app logo & CTA button |
| 2 | Demo Workspace | Highlight pending approvals |
| 3 | Approval flow | Annotate policy matrix |
| 4 | Connections | Show QR code & simulated consent |
| 5 | Safety dashboard | Emphasize rule IDs & audit log |
| 6 | Summary | Highlight key benefits |

---

*Feel free to pause at any point to answer questions. The demo is modular – you can jump directly to safety, connections, or money movement based on what matters most to your audience.*