# Demo Narration Script – ArkPay (3:00 hard cap)

*(Read the cue lines aloud as you navigate. Replace `<APP-URL>` with the demo host. Total: 180 seconds — rehearse with a timer. Personas: you are Ada, freelance designer in Lagos. All PayPal action is sandbox.)*

---

## 0. Problem (0:00–0:20)

> **Narrator:** "This is Ada. She designs flyers in Lagos, and her clients pay her over PayPal. Her money lives in this inbox — invoice requests she hasn't answered, late payers she hasn't chased, and somewhere in here, a scam. She has no finance team. Every minute of admin is a minute she's not earning."

- Show the messy Gmail inbox (3–4 money emails visible).
- Cut to the ArkPay landing page for one beat: "Get paid without the paperwork."

---

## 1. Invoice in one tap (0:20–1:10)

> **Narrator:** "A client just emailed: send me the invoice for last month's flyers, $450. Watch ArkPay's phone."

- Show the Telegram approval card arriving: payee, $450, purpose, source snippet, contact line "Known client".
- Narrate: "The agent read the email, matched the saved contact, and drafted the invoice. It cannot send anything — only Ada's tap can."
- Tap **Approve**.
- Cut to PayPal sandbox: invoice `INV2-…` appears as **SENT**.
- Narrate: "Email in, tap, invoice sent. Fifty seconds, zero typing."

---

## 2. The chase + the dispute (1:10–1:50)

> **Narrator:** "Fourteen days later, that invoice is still unpaid. ArkPay noticed — and drafted the chase in Ada's own tone."

- Show the seeded overdue invoice + the drafted reminder card. Tap **Approve** → "Reminder sent."
- Narrate: "Then this: the buyer opens a PayPal dispute. Twenty-day clock, and Ada's busy."
- Show the dispute detail: reason, stage, suggested next step.
- Show the drafted reply card — the **exact text** on the card. Tap **Approve** → "Defense sent."
- Narrate: "Gathered the context, drafted the reply, waited for her tap. That's the whole dispute product."

---

## 3. The trust moment (1:50–2:20) — judges remember this

> **Narrator:** "Now the email every freelancer dreads. A 'client' asking for a $1,200 refund — to a brand-new PayPal address."

- Show the email snippet on screen.
- Show the Telegram notice: **"Blocked: payee PayPal email changed, manual approval required."** No approve button exists.
- Open the audit entry: raw email → extracted JSON → rule IDs (`M-PAYOUT-SINGLE-CHANGED`, `NEVER-…`) → BLOCKED → no money moved.
- Narrate: "The Safety Engine stopped it in code, not in a prompt. This entry is the proof: what the agent read, the risk it flagged, and that nothing moved."

---

## 4. The loop closes (2:20–2:45)

> **Narrator:** "And when money does move, ArkPay hears it first."

- Pay the sandbox invoice (buyer side) → PayPal webhook fires → Telegram pings "paid" → dashboard owed/overdue/collected updates.
- Narrate: "Request, approval, invoice, chase, dispute, payment — one trace, one audit trail, end to end."

---

## 5. Vision (2:45–3:00)

> **Narrator:** "ArkPay: the pocket finance office for freelancers. Invoiced, chased, collected, and proven safe — starting in Lagos."

- Hold on the dashboard overview for the final 5 seconds. End card: repo URL + "PayPal sandbox — no live money moved."

---

## Cue-sheet for recording

| Beat | Time | Visual | Line to land |
|------|------|--------|--------------|
| Problem | 0:00 | Messy inbox → landing | "Money owed to her lives here." |
| Invoice | 0:20 | Telegram card → tap → INV2 SENT | "Email in, tap, invoice sent." |
| Chase | 1:10 | Overdue card → reminder sent | "The chase sends itself." |
| Dispute | 1:25 | Drafted reply card → sent | "The exact text, on the card." |
| Block | 1:50 | Blocked notice → audit entry | "Stopped in code. Nothing moved." |
| Paid | 2:20 | Webhook ping → dashboard | "One trace, end to end." |
| Vision | 2:45 | Dashboard hold → end card | "Invoiced, chased, collected, proven safe." |

---

*Setup checklist before recording: demo workspace seeded (overdue invoice + open dispute fixtures present); Telegram chat linked and notifications loud; PayPal sandbox buyer logged in on a second profile; timer visible. If any live step fails, the seeded rows still tell the story — never dead air, keep narrating.*
