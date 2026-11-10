import { BellRing, Copy, Repeat } from "lucide-react";
import Money from "@/components/arkay/Money";

const CASES = [
  {
    icon: BellRing,
    tag: "Unpaid invoice",
    title: "The client who never paid",
    body: "An invoice sits at SENT for two weeks. ArkPay notices, sends the polite chase, and tells you when it lands — or escalates when it doesn't.",
    mock: (
      <div className="rounded-[8px] border border-silver/60 bg-newsprint p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] text-steel">INV2-0081</span>
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">14 days overdue</span>
        </div>
        <p className="mt-2 text-[12px] text-graphite">“Gentle reminder sent · opened 2h ago”</p>
      </div>
    ),
  },
  {
    icon: Copy,
    tag: "Double invoice",
    title: "The client billed twice",
    body: "The same $780 invoice request arrives by email and by chat. ArkPay matches them before any card exists, so you approve once — never twice.",
    mock: (
      <div className="space-y-1.5 rounded-[8px] border border-silver/60 bg-newsprint p-3">
        <div className="flex items-center justify-between rounded-md bg-paper px-2 py-1.5 ring-1 ring-inset ring-silver/60">
          <span className="text-[11.5px] text-ink">Flyer design · email</span>
          <Money amount={780} className="text-[11.5px] text-ink" />
        </div>
        <div className="flex items-center justify-between rounded-md bg-paper px-2 py-1.5 ring-1 ring-inset ring-silver/60">
          <span className="text-[11.5px] text-ink">Flyer design · chat</span>
          <Money amount={780} className="text-[11.5px] text-ink" />
        </div>
        <p className="pt-0.5 text-[11px] font-medium text-emerald-700">Matched as one request ✓</p>
      </div>
    ),
  },
  {
    icon: Repeat,
    tag: "Disputed payment",
    title: "The client who charged back",
    body: "A buyer opens a PayPal dispute on work you delivered. ArkPay gathers the context, drafts your reply, and waits for your tap — the exact text, on the card.",
    mock: (
      <div className="rounded-[8px] border border-silver/60 bg-newsprint p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10.5px] text-steel">PP-R-1042</span>
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Needs you</span>
        </div>
        <p className="mt-2 text-[12px] text-graphite">“Drafted reply ready · evidence attached”</p>
      </div>
    ),
  },
];

export default function ProblemSection() {
  return (
    <section className="border-b border-silver/60 bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-[640px]">
          <h2 className="font-dm text-[32px] font-semibold leading-[1.12] tracking-tight text-ink sm:text-[40px]">
            No invoice, chase, or dispute gets missed.
          </h2>
          <p className="mt-4 text-[16px] leading-[1.6] text-graphite">
            Requests, approvals, and PayPal actions live in one place — so the money owed to you stops
            slipping through the inbox.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {CASES.map((c) => (
            <div key={c.title} className="rounded-[12px] border border-silver/60 bg-paper p-6 shadow-quo">
              <div className="flex items-center gap-2">
                <c.icon className="h-4 w-4 text-ink" strokeWidth={2} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">{c.tag}</span>
              </div>
              <h3 className="mt-3 font-dm text-[20px] font-semibold tracking-tight text-ink">{c.title}</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-graphite">{c.body}</p>
              <div className="mt-5">{c.mock}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
