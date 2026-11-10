# ArkPay

**Get paid without the paperwork.**

*The request is already in your inbox. Tap once, and it's invoiced, chased, and defended.*

ArkPay is the pocket finance office for freelancers getting paid. A client emails asking for an invoice; ArkPay reads it, drafts the PayPal invoice, and waits for one phone-tap approval before sending. Then it tracks the money through webhooks, chases late payers in your tone, and drafts your defense if a payment is disputed — every step guarded by a safety engine with a complete audit trail.

One customer: the solo earner. Ada designs flyers in Lagos; her clients pay her over PayPal. ArkPay is how she never loses a billable moment to admin again.

Built for the PayPal AI Hackathon. Deadline: **Nov 12, 2026, 12:00 PM PST (9:00 PM Lagos)**.

---

## 1. The Problem

Money owed to freelancers dies in unstructured chaos: emails, voice notes, chat messages. There is no finance team — every minute of admin is a minute not earning:

- A client emails "send me the invoice for last month" and it sits for days while you do the actual work.
- The same request arrives twice (email + chat) and the client gets billed twice — embarrassing and trust-burning.
- Late payers go unchased because following up feels awkward, so real money quietly never arrives.
- A buyer opens a PayPal dispute and the 20-day clock starts while you're busy; miss it and you lose by default.

Invoicing software assumes you already entered the data. Nobody owns the layer *before* the invoice exists — or the chase *after* it's sent.

## 2. The Solution

ArkPay is an agent that lives where you already talk.

1. **Listens** to your inbox (Gmail first).
2. **Understands** each email: is a client asking for an invoice, is this money you owe, or is it noise?
3. **Asks you** on Telegram: "Ada from Lagos Print asked for an invoice, $450 for flyers. Send it?" with Approve / Edit / Ignore buttons.
4. **Sends** through PayPal: creates and sends the invoice the moment you tap.
5. **Chases** the loop: tracks payment through webhooks, reminds late payers in your tone, flags duplicates.
6. **Defends** your money: when a buyer disputes, ArkPay gathers the context and drafts your reply, offer, or evidence — the exact text waits on an approval card before anything sends.
7. **Remembers your people**: a smart contacts book of clients (PayPal email or ID, usual amounts, payment history), so the next request is handled faster, retainers are tracked, and anything unusual stands out.

## 3. Why the AI Is Essential (not decoration)

Remove the AI and the product stops working. The AI does the work no rule engine can:

| AI job | What it does |
|---|---|
| Classification | Invoice request vs payout instruction vs payment confirmation vs spam vs casual chat |
| Extraction | Amount, currency, person, purpose, due date from messy emails, signatures, attachments |
| Risk reasoning | Spots duplicates, changed payee details, amounts that don't match history, suspicious urgency |
| Drafting | Writes the invoice line items, a polite payment reminder in the user's tone, and dispute replies with evidence |
| Learning | Builds a profile: usual amounts, which clients pay late, how you like chases worded |
| Contact memory | Matches a name or email to a saved contact, auto-fills details, and notices when something about a known contact changes |
| Collection | Decides what to chase, when, and how firmly — and what the next step on a dispute should be |

## 4. PayPal Integration (central, not bolted on)

- **PayPal Invoicing API**: create, send and track invoices from extracted data
- **PayPal Payouts**: client refunds and contractor payments after approval (single + batch where the sender country is eligible; the core loop never depends on it)
- **PayPal Subscriptions**: manage recurring client billing — portfolio report (MRR, past-due, at-risk), approval-gated cancel/suspend/resume, failed-payment dunning signals over webhooks
- **PayPal Disputes**: full seller-side lifecycle — list, stage-aware suggested next step, LLM-drafted replies, approval-gated message/offer/evidence/claim-accept with HATEOAS legality checks, resolution tracking over webhooks
- **Webhooks**: payment received, payout success or failure, subscription lifecycle + failed payments, dispute opened/resolved — driving reconciliation, reminders and dunning
- **Agent Toolkit / MCP server** (optional): let the agent call PayPal actions through the official tool layer. Verify in the PayPal docs which is easier to demo.

All built on the free PayPal sandbox.

## 5. The Startup Angle

**Market:** 150M+ freelancers globally, most without proper finance software — and no finance team at all. Highly underserved in Nigeria and across Africa, where client requests flow over email and chat and formal invoicing is rare. *(Verify figures before putting them in the final deck.)*

**Wedge:** One customer, one loop: the solo earner getting paid. Start with "a client emailed me about money" → tap → invoiced, chased, defended. Teams, payroll and supplier runs are explicitly *not* this product — that's a different customer with a different office.

**Moat:**
- *Learns you*: usual amounts, which clients pay late, how you like chases worded. Switching cost grows with every month of history.
- *Client book + retainers*: the saved people book makes every future request faster and safer, and monthly retainer tracking turns ArkPay from an occasional tool into something used every week.
- *Channel-native*: email today, Telegram voice notes next (WhatsApp Business after). Zapier-style tools can't read intent across channels.
- *Payment Safety Engine*: approval locking, fraud flags and an audit log make a solo operator comfortable letting an agent touch their money.

**Payment rails:** PayPal is the rail for the hackathon and for cross-border use. Receiving (invoicing, reminders, dispute defense) works for a Nigerian freelancer today; PayPal Payouts is not open to senders in every country, so sender-side depth waits on eligibility and local rails (e.g. Paystack, to be validated). The agent, the Payment Safety Engine and the approval layer are built to be rail-agnostic.

**Business model:** Free tier (a few actions per month), subscription for unlimited use. No cut of the invoices you send.

**Vision:** Every freelancer's money owed: invoiced, chased, collected, and proven safe.

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
- **Expense tracking:** photograph a receipt, the AI reads and categorizes it against your income for the month.
- **Cash-flow check:** ask "can I afford this month?" and the agent compares outstanding invoices against upcoming bills and warns about gaps.

**Phase 3: Protect and expand**
- **Dispute defender:** ✅ shipped (Nov 7) — when a customer opens a PayPal dispute, the agent gathers the context, drafts the response, and asks you to approve the exact text before anything sends. Offer, evidence and claim-acceptance included.
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

If you slip, cut in this order: Slack, scheduling detail, learning and auto-approve, payroll depth, dashboard polish. **Never cut:** the Telegram approval, the invoice send, the chase, the webhook loop, the dispute draft.

## 10. The 3-Minute Demo (hard cap, judges won't watch past it)

- **0:00 to 0:20**: The problem. One face: Ada, freelance designer in Lagos. Show her messy inbox and say "money owed to her lives here, and nobody owns this layer."
- **0:20 to 1:10**: Client email arrives asking for an invoice. Telegram pings, the agent recognizes the saved contact. Tap Approve. Show the PayPal invoice appear as SENT.
- **1:10 to 1:50**: Fourteen days later (seeded overdue invoice): ArkPay drafted the chase in her tone — approve, reminder sent. Then the buyer disputes: the agent gathers the context and drafts her reply with the exact text on the card. Approve — defense sent.
- **1:50 to 2:20**: A "client" emails asking for a refund to a brand-new PayPal address. The Payment Safety Engine stops it with a visible label: "Blocked: payee PayPal email changed, manual approval required." Then show the audit entry: what the agent read, the risk it flagged, and that no money moved. This is the moment judges remember.
- **2:20 to 2:45**: Webhook fires, an invoice gets paid, the dashboard's owed/overdue/collected updates.
- **2:45 to 3:00**: The vision: every freelancer's money owed — invoiced, chased, collected, and proven safe, starting in Lagos.

## 11. Devpost Checklist

- [ ] Working prototype in the sandbox
- [ ] Meaningful PayPal integration (Invoicing, reminders, Disputes, Subscriptions, Webhooks — plus Payouts where eligible)
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
| Payouts sandbox quirks | The invoice → chase → dispute loop never depends on Payouts; sender-side stays a secondary path |
| AI misreads an email | Human approval by default, show the confidence score on every card |
| Batch payout errors | Cap batch size and total, always preview recipients, idempotency keys |
| Scope creep | The cut-order list in section 9 |