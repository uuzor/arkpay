import { Link } from "@tanstack/react-router";
import { ArrowRight, Play } from "lucide-react";
import ApprovalMock from "@/components/landing/ApprovalMock";
import { useAuth } from "@/lib/AuthContext";

export default function Hero() {
  const { isAuthenticated } = useAuth();
  return (
    <section className="relative overflow-hidden border-b border-silver/60">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] grid-lines opacity-40" />
      <div className="relative mx-auto grid max-w-[1200px] items-center gap-14 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:py-24">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-[8px] border border-silver/70 bg-paper px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-graphite">
            <span className="h-1.5 w-1.5 rounded-full bg-ember" />
            AI payments agent
          </span>

          <h1 className="mt-6 font-dm text-[42px] font-semibold leading-[1.04] tracking-tight text-ink sm:text-[56px] lg:text-[64px]">
            One shared place for every money request.
          </h1>

          <p className="mt-6 max-w-[540px] text-[18px] leading-[1.5] text-graphite">
            ArkPay is the payments agent with a safety engine, for businesses and freelancers: it reads
            a money request from email or chat, drafts the PayPal invoice or payout, and waits for one
            approval before executing — with policy caps, risk checks, idempotency, and a full audit trail.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/overview"
              className="inline-flex items-center gap-2 rounded-[10px] bg-ink px-6 py-3.5 text-[16px] font-semibold text-paper transition-colors hover:bg-carbon"
            >
              {isAuthenticated ? "Go to dashboard" : "Open the demo"}{" "}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-[10px] px-4 py-3.5 text-[16px] font-medium text-ink transition-colors hover:bg-newsprint"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-paper">
                <Play className="ml-0.5 h-3 w-3 fill-current" />
              </span>
              See how it works (2:00)
            </a>
          </div>

          <p className="mt-6 text-[12px] text-pewter">
            PayPal sandbox · No card required · Every money move needs your tap
          </p>
        </div>

        <div className="animate-fade-up [animation-delay:120ms]">
          <ApprovalMock />
        </div>
      </div>
    </section>
  );
}
