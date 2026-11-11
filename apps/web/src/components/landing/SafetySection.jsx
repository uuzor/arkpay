import { Fingerprint, ShieldCheck, EyeOff } from "lucide-react";
import CheckRow from "@/components/arkay/CheckRow";

const PILLARS = [
  {
    icon: ShieldCheck,
    title: "Deterministic controls, not prompt rules",
    body: "Currency allow-list, amount caps, email format, date sanity, known-versus-new payee and duplicate checks all run in code before an action can be built.",
  },
  {
    icon: Fingerprint,
    title: "Approvals are hashed and single use",
    body: "Each card hashes payee, amount, currency, purpose and idempotency key. Any edit voids it and issues a new hash. Execution recomputes and refuses a mismatch.",
  },
  {
    icon: EyeOff,
    title: "Credentials never reach the model",
    body: "PayPal keys live only in the execution service. A hijacked email has nothing to steal, and a double-tapped approve never pays twice.",
  },
];

export default function SafetySection() {
  return (
    <section id="safety" className="scroll-mt-24 border-b border-silver/60 bg-paper">
      <div className="mx-auto grid max-w-[1200px] gap-14 px-6 py-20 lg:grid-cols-[1fr_0.85fr] lg:gap-16">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-steel">Payment Safety Engine</p>
          <h2 className="mt-3 font-dm text-[32px] font-semibold leading-[1.12] tracking-tight text-ink sm:text-[40px]">
            Every action passes the same gate. Or it doesn't happen.
          </h2>
          <div className="mt-10 space-y-8">
            {PILLARS.map((p) => (
              <div key={p.title} className="flex gap-4">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-ink">
                  <p.icon className="h-4 w-4 text-paper" strokeWidth={1.8} />
                </span>
                <div>
                  <h3 className="font-dm text-[17px] font-semibold tracking-tight text-ink">{p.title}</h3>
                  <p className="mt-1.5 max-w-[460px] text-[14px] leading-[1.6] text-graphite">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="h-fit rounded-[12px] border border-silver/60 bg-newsprint p-6 shadow-quo">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">Checks on REQ-1042</p>
            <span className="font-mono text-[10.5px] text-steel">12 of 12 run</span>
          </div>
          <div className="mt-3 divide-y divide-silver/60">
            <CheckRow label="Currency allow-list" detail="USD, EUR, GBP" state="pass" />
            <CheckRow label="Vendor spending cap" detail="$1,200 of $2,000" state="pass" />
            <CheckRow label="Daily spending cap" detail="$3,050 of $6,000" state="pass" />
            <CheckRow label="Duplicate + similarity scan" detail="No match in 90 days" state="pass" />
            <CheckRow label="Prompt-injection scan" detail="\u201cpay today, old account closed\u201d" state="warn" />
            <CheckRow label="Payee PayPal email" detail="Changed 2 days ago" state="fail" />
          </div>
          <div className="mt-4 rounded-[10px] bg-paper p-3 ring-1 ring-inset ring-silver/60">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-steel">Decision</p>
            <p className="mt-1 text-[13px] font-semibold text-ink">Manual approval required</p>
            <p className="mt-1 text-[12px] leading-5 text-graphite">
              Payee details changed on a known contact. The card shows what changed and locks the old approval.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
