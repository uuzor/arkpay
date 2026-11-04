import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    body: "For trying the loop on a real inbox.",
    features: ["5 actions a month", "Invoices + reminders", "Contacts book", "Sandbox PayPal"],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Freelancer",
    price: "$19",
    cadence: "per month",
    body: "For one person who bills clients all week.",
    features: ["Unlimited requests", "Payouts after approval", "Payee-change detection", "Late-payer chasing"],
    cta: "Start free trial",
    highlight: true,
  },
  {
    name: "Studio",
    price: "$49",
    cadence: "per month",
    body: "For a small team with staff and suppliers.",
    features: ["Everything in Freelancer", "Monthly payroll batches", "Auto-approve under limits", "Full audit export"],
    cta: "Start free trial",
    highlight: false,
  },
];

export default function PricingSection() {
  return (
    <section id="pricing" className="scroll-mt-24 border-b border-silver/60 bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="max-w-[560px]">
          <h2 className="font-dm text-[32px] font-semibold leading-[1.12] tracking-tight text-ink sm:text-[40px]">
            Priced like software, not like a payment processor.
          </h2>
          <p className="mt-4 text-[15px] leading-[1.65] text-graphite">
            A small fee applies to automated payouts. No cut of the invoices you send.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={cn(
                "flex flex-col rounded-[12px] border p-6",
                p.highlight ? "border-ink bg-ink text-paper shadow-quo" : "border-silver/60 bg-paper",
              )}
            >
              <div className="flex items-center justify-between">
                <p className={cn("text-[13px] font-semibold", p.highlight ? "text-paper" : "text-ink")}>{p.name}</p>
                {p.highlight ? (
                  <span className="rounded-md bg-highlighter px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink">
                    Most popular
                  </span>
                ) : null}
              </div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span className={cn("font-dm text-[34px] font-semibold tracking-tight tabular", p.highlight ? "text-paper" : "text-ink")}>{p.price}</span>
                <span className={cn("text-[12px]", p.highlight ? "text-paper/60" : "text-pewter")}>{p.cadence}</span>
              </div>
              <p className={cn("mt-2 text-[13px] leading-[1.55]", p.highlight ? "text-paper/70" : "text-graphite")}>{p.body}</p>
              <ul className="mt-5 flex-1 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className={cn("flex items-start gap-2 text-[13px]", p.highlight ? "text-paper/85" : "text-graphite")}>
                    <span className={cn("mt-1.5 h-1 w-1 shrink-0 rounded-full", p.highlight ? "bg-highlighter" : "bg-steel")} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/login"
                className={cn(
                  "mt-6 rounded-[10px] py-2.5 text-center text-[13px] font-semibold transition-colors",
                  p.highlight
                    ? "bg-paper text-ink hover:bg-highlighter"
                    : "border border-silver/70 text-ink hover:bg-newsprint",
                )}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
