# ArkPay

**Never type an invoice again. Just talk.**

*Read the request. Approve once. Pay safely on PayPal.*

ArkPay is the AI payments agent for freelancers and micro-businesses. It reads money requests from email and chat, prepares the PayPal invoice or payout, gets one secure approval, and executes it, with fraud checks and a complete audit trail.

Built for the PayPal AI Hackathon. Deadline: **Nov 12, 2026, 12:00 PM PST (9:00 PM Lagos)**.

---

## 1. The Problem

Money requests live in unstructured chaos: emails, WhatsApp voice notes, Slack messages, screenshots of bank details. Freelancers and tiny businesses handle this by hand:

- A client emails "send me the invoice for last month" and it sits for days.
- A supplier emails payment details and you retype them into a payment form (and typos or fake changed details cost real money).
- Late payers go unchased because following up feels awkward.

Invoicing software assumes you already entered the data. Nobody owns the layer *before* the invoice exists.

## 2. The Solution

ArkPay is an agent that lives where you already talk.

1. **Listens** to your inbox (Gmail first).
2. **Understands** each email: is someone asking me to pay, asking me for an invoice, or is it noise?
3. **Asks you** on Telegram: "Ada from Lagos Print asked for an invoice, $450 for flyers. Send it?" with Approve / Edit / Ignore buttons.
4. **Acts** through PayPal: creates and sends the invoice, or pays the person via Payouts.
5. **Closes the loop**: tracks the payment through webhooks, chases late payers, flags duplicates.
6. **Remembers your people**: a smart contacts book of clients, suppliers and staff (PayPal email or ID, usual amounts, payment history), so the next request is handled faster and anything unusual stands out.
7. **Runs payroll**: say "pay my team" and ArkPay assembles the batch from saved contacts, shows the total and recipients, and pays everyone after one approval. Monthly runs are prepared automatically and still wait for your tap.

## 3. Why the AI Is Essential (not decoration)

Remove the AI and the product stops working. The AI does the work no rule engine can:

| AI job | What it does |
|---|---|
| Classification | Payment request vs invoice request vs spam vs casual chat |
| Extraction | Amount, currency, person, purpose, due date from messy emails, signatures, attachments |
| Risk reasoning | Spots duplicates, changed payee details, amounts that don't match history, suspicious urgency |
| Drafting | Writes the invoice line items and a polite payment reminder in the user's tone |
| Learning | Builds a profile: who you always pay, usual amounts, which clients pay late |
| Contact memory | Matches a name or email to a saved contact, auto-fills details, and notices when something about a known contact changes |
| Payroll assembly | Turns "pay my team" into a checked batch with amounts pulled from history, flagging anyone who looks off |

## 4. PayPal Integration (central, not bolted on)

- **PayPal Invoicing API**: create, send and track invoices from extracted data
- **PayPal Payouts**: pay suppliers, contractors and staff after approval, both single payments and batch payouts
- **Webhooks**: payment received, invoice viewed, payout success or failure, which drives reconciliation and reminders
- **Agent Toolkit / MCP server** (optional): let the agent call PayPal actions through the official tool layer. Verify in the PayPal docs which is easier to demo.

All built on the free PayPal sandbox.

## 5. The Startup Angle

**Market:** 400M+ small businesses and freelancers globally, most without proper finance software. Highly underserved in Nigeria and across Africa, where requests flow over email and WhatsApp and formal invoicing is rare. *(Verify figures before putting them in the final deck.)*

**Wedge:** Start with the one painful moment, "someone emailed me about money", then expand into a complete payments agent for micro-businesses.

**Moat:**
- *Learns you*: over time the routine payments within your limits are auto-approved, and approvals shrink to only the weird ones. Switching cost grows with every month of history.
- *Contacts and payroll*: the saved people book makes every future request faster and safer, and recurring staff pay turns ArkPay from an occasional tool into something used every month.
- *Channel-agnostic*: email today, WhatsApp voice notes, Slack and screenshots next. Zapier-style tools can't read intent across channels.
- *Payment Safety Engine*: spending rules, approval locking, fraud flags and an audit log make people comfortable letting an agent move money.

**Payment rails:** PayPal is the rail for the hackathon and for cross-border use. PayPal Payouts is not open to senders in every country, and Nigeria is not on PayPal's current Payouts country list, so the Nigeria roadmap adds local payment rails alongside PayPal. The agent, the Payment Safety Engine and the approval layer are built to be rail-agnostic.

**Business model:** Free tier (a few actions per month), subscription for unlimited use, plus a small fee on automated payouts.

**Vision:** Every micro-business money request: read, approved, paid, and proven safe.

## 6. Payment Safety Engine (judges will ask)

The Payment Safety Engine is the set of checks every action must pass before any money moves. It is a named, visible part of ArkPay, not a footnote.


- Human approval by default; auto-approve only under user-set limits
- Per-vendor and per-day spending caps
- Idempotency keys so a double-tapped approve never pays twice
- Payee-change detection: a known vendor suddenly giving a new PayPal email forces manual approval
- Batch payouts always show total amount and every recipient before approval, with a batch size and total cap
- Store PayPal emails or IDs for contacts, not raw bank details

### Execution policy

One versioned policy decides every action. Rows are action types, columns are payee status. Amounts above the user's auto-approve limit always need manual approval regardless of cell; amounts above any cap are always blocked. Every decision records which policy version judged it.

| Action | Known payee | New payee | Changed payee details |
|---|---|---|---|
| Invoice (send) | Allow under limit, else approve | Approve (manual) | Approve (manual), show change |
| Payout single | Allow under limit, else approve | Approve + extra confirmation | Block, manual override only |
| Payout batch | Approve (total + recipients shown) | Approve + extra confirmation | Block, manual override only |

NEVER rules (no override inside a run — a human must create a new action):

- Never execute on an expired or already-used approval.
- Never change payee, amount, currency, or purpose after approval (edits void it).
- Never exceed per-vendor, per-day, or batch caps.
- Never let model output reach PayPal without code validation.

### Prompt-injection defences

Every email and attachment is written by a stranger, so ArkPay treats all of it as untrusted data, never as instructions.

- **The model proposes, code disposes.** The LLM only extracts fields (payee, amount, currency, purpose, due date) into a fixed JSON schema. It has no tools and no PayPal access. Separate deterministic code validates the fields and builds the action.
- **Least privilege.** PayPal credentials live only in the execution service and never enter the model's context, so a hijacked prompt has nothing to steal or call.
- **Validate in code, not in the prompt.** Currency allow-list, amount caps, email format, date sanity, known-versus-new payee check, and duplicate check. Prompt-level rules are not financial controls.
- **Flag manipulation attempts.** Text that addresses the assistant ("ignore previous instructions", "approve automatically", "skip verification") or pushes urgency is treated as a risk signal and shown on the approval card.
- **Changed payee means stop.** A known vendor with a new PayPal email, or any new payee, always requires manual approval and shows what changed.
- **Full audit trail.** Every action carries one trace, correlated by action ID from email to webhook: the raw email, the model I/O (prompt version, extracted JSON, confidence), the policy evaluation (policy version + rules fired), the approval record (who, when, hash), the PayPal request/response IDs, and every webhook event. The dashboard and Telegram both surface it — the demo's fraud moment ends on this entry.

### Approval locking

An approval must apply to exactly what the user saw, and nothing else.

- **Show the exact action.** The Telegram card displays payee name and PayPal email, amount, currency, purpose and the source email snippet.
- **Hash the action.** When the card is created, ArkPay hashes the payee, amount, currency, purpose and idempotency key and stores it. The Approve button carries only the action ID.
- **Edits void the old approval.** Any change creates a new action with a new hash and needs a fresh approval.
- **Verify before executing.** The execution service recomputes the hash from the stored record and refuses to run if it doesn't match the approved one.
- **Single use, short life.** Each approval works once and expires after a short window.
- **Verified approver.** Only the linked Telegram account can approve. New payees and higher-value actions need an extra confirmation, such as re-entering the amount.

## 7. Roadmap After the Hackathon

The hackathon build proves the core loop: money requests in, one approval, PayPal action out. Here is where ArkPay goes next.

**Phase 1: Make capture effortless**
- **Voice note to invoice:** say "invoice Ada $450 for flyers" in a Telegram voice note (WhatsApp Business next) and ArkPay creates the PayPal invoice. This is the natural way people already ask for money in Nigeria and across Africa.
- **Recurring billing:** when a client says "I'll pay monthly," the agent sets up a PayPal subscription instead of someone chasing every month.

**Phase 2: Run the money, not just the requests**
- **Receipt to reimbursement:** staff photograph a receipt, the AI reads and categorizes it, and ArkPay reimburses them through Payouts after approval.
- **Cash-flow check:** before payroll, ask "can I afford this month?" and the agent compares outstanding invoices against upcoming payments and warns about gaps.

**Phase 3: Protect and expand**
- **Dispute defender:** when a customer opens a PayPal dispute, the agent gathers the order evidence, drafts the response, and asks you to approve it.
- **More channels:** Slack and other chat apps as extra places to ask for and approve payments.
- **Local payment rails:** add local rails (for example Paystack for Nigeria, to be validated) so Nigerian businesses can collect and pay without depending on PayPal Payouts eligibility.

---

## 8. Architecture

```
Gmail  --->  Ingest worker  --->  LLM (classify + extract + risk)
                                        |
                       Decision record + Contacts book (Postgres)
                                        |
                          Telegram bot (Approve / Edit / Ignore)
                                        |
          PayPal Invoicing / Payouts, single + batch (sandbox)
                                        |
                     PayPal Webhooks ---> status + reminders ---> Dashboard (Next.js)
```

**Stack:** NestJS + PostgreSQL backend, Next.js dashboard, an OpenAI-compatible LLM (`deepseek/deepseek-v4.1-flash-1017`) for reasoning with structured JSON output, Gmail API, Telegram Bot API, PayPal sandbox, deployed on Vultr (Render deploy optional for the Best Use of Render prize).

Optional extras: Elastic for duplicate and similarity search, Zapier or Slack as a second channel.

## 9. Twelve-Day Build Plan

Aim to finish **Nov 11** and keep Nov 12 morning as pure buffer.

| Day | Date | Goal | Done when |
|---|---|---|---|
| 1 | Sat Oct 31 | PayPal sandbox account, REST credentials, create one invoice via API. Public repo with an MIT licence, and Postgres schema. | Test invoice appears in sandbox dashboard |
| 2 | Sun Nov 1 | Gmail OAuth (testing mode) and inbox polling. Store raw emails. | New email lands in DB within a minute |
| 3 | Mon Nov 2 | LLM pipeline: classify and extract to structured JSON. Test on 20 sample emails. | 90%+ correct on your samples |
| 4 | Tue Nov 3 | Telegram bot: decision cards with Approve / Edit / Ignore. Contacts book: save and look up contacts. | Button tap updates the decision, and a known sender is recognized |
| 5 | Wed Nov 4 | Approve triggers PayPal invoice creation and sending, auto-filled from contacts. | End-to-end: email in, tap, invoice sent |
| 6 | Thu Nov 5 | One-off payout via Payouts, plus simple bulk pay ("pay my team" from saved contacts). Idempotency, batch caps, total and recipient preview. | Single and batch sandbox payouts succeed, double-tap is safe |
| 7 | Fri Nov 6 | Webhooks: paid, viewed, failed. Status updates sent back to Telegram. | Paying the sandbox invoice pings you |
| 8 | Sat Nov 7 | Payment Safety Engine: duplicate detection, changed payee email, amount anomalies, injection flags. | A fake "our PayPal email changed" message gets blocked |
| 9 | Sun Nov 8 | Monthly payroll scheduling (prepares the run, waits for approval), auto-approve rules, late-payer reminder drafts. | Monthly run is prepared and a routine request auto-handles under the limit |
| 10 | Mon Nov 9 | Dashboard (activity feed, audit log, rules). Deploy to Vultr (Render optional for prize). | Live public URL works |
| 11 | Tue Nov 10 | Polish, edge cases, optional Slack input. Write README and Devpost text. | Fresh-account run-through works |
| 12 | Wed Nov 11 | Record the 3-minute demo, upload it publicly to YouTube, submit on Devpost. | Submitted with hours to spare |

If you slip, cut in this order: Slack, monthly scheduling, learning and auto-approve, dashboard polish. **Never cut:** the Telegram approval, the PayPal action, the webhook loop, simple bulk pay.

## 10. The 3-Minute Demo (hard cap, judges won't watch past it)

- **0:00 to 0:20**: The problem. Show a messy inbox and say "money requests live here, and nobody owns this layer."
- **0:20 to 1:10**: Email arrives asking for an invoice. Telegram pings, the agent recognizes the saved contact. Tap Approve. Show the PayPal invoice appear.
- **1:10 to 1:50**: Supplier email asks for payment, you approve, payout executes. Then type "pay my team": ArkPay shows the batch total and recipients, you approve once, everyone gets paid.
- **1:50 to 2:20**: A known vendor emails that their PayPal address has changed and asks you to pay the new one. The Payment Safety Engine stops it with a visible label: "Blocked: payee PayPal email changed, manual approval required." Then show the audit entry: what the agent read, the risk it flagged, and that no money moved. This is the moment judges remember.
- **2:20 to 2:45**: Webhook fires, the invoice gets paid, the dashboard updates.
- **2:45 to 3:00**: The vision: every micro-business money request, read, approved, paid and proven safe, starting in Lagos.

## 11. Devpost Checklist

- [ ] Working prototype in the sandbox
- [ ] Meaningful PayPal integration (Invoicing, single and batch Payouts, Webhooks)
- [ ] Contacts book working in the demo
- [ ] AI central to the workflow
- [ ] README: setup, architecture diagram, how to test
- [ ] Public GitHub repo with an open-source licence (e.g. MIT) visible at the top
- [ ] Public YouTube demo video under 3 minutes
- [ ] All submission materials in English
- [ ] Optional sponsor prize targeting (Render deploy if pursuing the Render prize; Vultr deployment is live)
- [ ] Read the Official Rules once before submitting

## 12. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| WhatsApp Business API needs approval and setup | Use Telegram for the MVP, show WhatsApp as the roadmap |
| Gmail OAuth verification | Stay in testing mode with your own account and test users |
| Payouts sandbox quirks | Test on Day 1 and 6, keep a fallback of invoice-only demo |
| AI misreads an email | Human approval by default, show the confidence score on every card |
| Batch payout errors | Cap batch size and total, always preview recipients, idempotency keys |
| Scope creep | The cut-order list in section 9 |