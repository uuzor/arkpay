# ArkPay — Meta Hackathon Video Script (~2:45)

Read time: ~360 words ≈ 2:40 at a calm demo pace. Record screen + voiceover;
captions on. Name the Muse models out loud — that's the Stage 1 gate.

## 0:00 — Problem (title card)

**On screen:** title card: "ArkPay — the payments agent with a safety engine.
Muse Spark 1.3 · Muse Wonder · Voice Transcribe · Spark vision."

**Say:** "Freelancers drown in money requests — invoices to send, suppliers to
pay, scam emails mixed in. AI agents can help, but nobody trusts a bot with
their money. ArkPay is a payments agent that can't steal your money: it drafts
every PayPal invoice and payout, then waits for one human approval — with
policy caps, risk checks, and a full audit trail. It runs on Meta's models."

## 0:20 — Email → extraction (dashboard Requests)

**On screen:** dashboard Requests list; open one request showing extracted
payee / amount / purpose + confidence.

**Say:** "A client email arrives. Muse Spark reads it and extracts the payee,
amount, and purpose — twenty out of twenty on our extraction suite. Noise like
newsletters is ignored automatically; nothing moves without a draft."

## 0:50 — Approval card → SENT (phone + PayPal)

**On screen:** Telegram approval card on a phone ("Send invoice $450 to Ada
Obi"); tap approve; cut to PayPal sandbox showing the invoice SENT.

**Say:** "The draft lands as an approval card in Telegram. One tap — and only
one tap — sends a real invoice through the PayPal sandbox. Every hop is
audited: created, approved, executed."

## 1:25 — Fraud blocked (safety engine)

**On screen:** the fraud email ("our PayPal email changed… urgent"); the
BLOCKED card naming PAYEE_CHANGED + URGENCY, no approve button; audit row.

**Say:** "Now the attack. A supplier's email says their PayPal changed and to
pay urgently. The safety engine blocks it — payee change plus urgency — with
no approve button at all. The same policy re-checks at execution time, so a
sneaky edit between approval and send still can't move money."

Demo input (verified): known contact gets "our PayPal email changed… pay
100.00 USD to new-address… urgent" → Gate 1 BLOCKED, flags
PAYEE_CHANGED,URGENCY.

## 1:50 — Voice + vision (name the models)

**On screen:** Telegram voice note → transcript → payout draft card; then a
receipt photo → transcribed lines → invoice draft.

**Say:** "It also hears and sees. A voice note is transcribed by Muse Voice
Transcribe into a payout draft. A photographed receipt is read by Spark's
vision into an invoice draft. Both still wait for your approval."

Verified lines: "Pay Daniel E $780 for the paper supply"; receipt "ACME
HOSTING / Invoice 1042 / 2026-10-15 / TOTAL: $450.00".

## 2:20 — Dashboard: audit, rules, schedules

**On screen:** audit drawer tracing one action end to end; safety rules page;
schedules page (payroll prep, invoice reminders).

**Say:** "The dashboard shows everything: the audit trail for every dollar,
the policy rules that gate it, and scheduled payroll prep and invoice
reminders. And your agent chats with Wonder, Meta's flagship reasoning model."

## 2:40 — End card

**On screen:** repo URL + live demo URL, "Built Oct 27 – Nov 4, 2026. Standard
tier — financial data never trains models."

**Say:** "ArkPay — an AI payments agent with a safety engine, built on Meta.
Repo and live demo at the links below."

---

## Recording checklist

- [ ] Demo workspace logged in; end-card links correct
- [ ] Telegram re-paired (`/link ARKPAY-CHQR5M`) so cards arrive live
- [ ] Fraud contact seeded (or run against local API for that beat)
- [ ] PayPal sandbox invoice from the tap is visible (SENT status)
- [ ] Voice note + receipt photo ready to send during recording
- [ ] No secrets on screen (sanitize URLs, hide API keys)
- [ ] Export ≤3:00, upload (YouTube unlisted or CV-native), test logged-out
