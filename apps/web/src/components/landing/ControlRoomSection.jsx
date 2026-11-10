import { Lock, ArrowRight } from "lucide-react";
import StatusPill from "@/components/arkay/StatusPill";
import RiskChip from "@/components/arkay/RiskChip";
import CheckRow from "@/components/arkay/CheckRow";

const JSON_ROWS = [
  ["intent", '"payout"'],
  ["payee", '"Lagos Print Co"'],
  ["paypal_email", '"billing@lagosprint-new.ng"'],
  ["amount", "1200.00"],
  ["currency", '"USD"'],
  ["purpose", '"Refund: March deposit"'],
];

export default function ControlRoomSection() {
  return (
    <section id="product" className="scroll-mt-24 border-b border-silver/60 bg-newsprint">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-[600px]">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-steel">The trust moment</p>
          <h2 className="mt-3 font-dm text-[32px] font-semibold leading-[1.12] tracking-tight text-ink sm:text-[40px]">
            You see exactly what the agent read, and exactly what it wants to do.
          </h2>
        </div>

        <div className="mt-10 overflow-hidden rounded-[18px] border border-silver/60 bg-paper shadow-quo">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-silver/60 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-steel">REQ-1042</span>
              <span className="text-[13px] font-medium text-ink">Client refund request</span>
            </div>
            <div className="flex items-center gap-2">
              <RiskChip type="changed_payee" />
              <StatusPill status="blocked" />
            </div>
          </div>

          <div className="grid lg:grid-cols-3">
            <div className="border-b border-silver/60 p-5 lg:border-b-0 lg:border-r">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-steel">Raw email</p>
              <p className="mt-3 text-[12px] text-pewter">From: ada@lagosprint.ng</p>
              <p className="mt-2 text-[13px] leading-[1.7] text-graphite">
                Hi, please refund my March deposit to my new PayPal — use{" "}
                <span className="bg-highlighter/60 px-1 text-ink">billing@lagosprint-new.ng</span> for the $1,200.
                Kindly pay today, my old account is closed.
              </p>
              <p className="mt-3 flex items-center gap-1.5 font-mono text-[10.5px] text-red-600">
                <Lock className="h-3 w-3" /> urgency pattern flagged
              </p>
            </div>

            <div className="border-b border-silver/60 p-5 lg:border-b-0 lg:border-r">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-steel">Extracted JSON</p>
              <div className="mt-3 space-y-1 font-mono text-[11.5px] leading-6">
                {JSON_ROWS.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-steel">"{k}":</span>
                    <span className="text-ink">{v}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-pewter">No tools. No PayPal access. Fields only.</p>
            </div>

            <div className="p-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-steel">Safety checks</p>
              <div className="mt-2 divide-y divide-silver/50">
                <CheckRow label="Currency allow-list" detail="USD permitted" state="pass" />
                <CheckRow label="Amount within vendor cap" detail="$1,200 of $2,000" state="pass" />
                <CheckRow label="Duplicate invoice scan" detail="No match in 90 days" state="pass" />
                <CheckRow label="Payee PayPal email" detail="Changed 2 days ago — was ada@lagosprint.ng" state="fail" />
              </div>
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[11.5px] font-medium text-red-700 ring-1 ring-inset ring-red-100">
                Blocked: manual approval required. No money moved.
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-pewter">
          <span className="font-mono">hash 8f2c…a41d</span>
          <span className="font-mono">idem pay_9f21c</span>
          <a href="#safety" className="inline-flex items-center gap-1 font-medium text-ink">
            How approval locking works <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
