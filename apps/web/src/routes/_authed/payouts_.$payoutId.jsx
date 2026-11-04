import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import StatusPill from "@/components/arkay/StatusPill";
import RiskChip from "@/components/arkay/RiskChip";
import Money from "@/components/arkay/Money";
import ApprovalDrawer from "@/components/arkay/ApprovalDrawer";
import { actionTone, riskLabel, riskType, summarizeJson, timeAgo } from "@/lib/actionShapes";
import { payoutDetailQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/payouts_/$payoutId")({
  head: () => ({ meta: [{ title: "Payout · Arkay" }] }),
  component: PayoutDetailPage,
});

function PayoutDetailPage() {
  const { payoutId } = Route.useParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data, isLoading, isError, error } = useQuery(payoutDetailQuery(payoutId));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-36 animate-pulse rounded-xl bg-fog" />
        <div className="h-64 animate-pulse rounded-xl bg-fog" />
      </div>
    );
  }

  if (isError || !data?.action) {
    const notFound = error?.status === 404;
    return (
      <div className="rounded-xl border border-mist/70 bg-paper px-4 py-12 text-center">
        <p className="text-[14px] font-semibold text-ink">{notFound ? "Payout not found" : "Could not load this payout"}</p>
        <p className="mt-1 text-[12px] text-pewter">
          {notFound ? "It may belong to another workspace." : (error?.message ?? "Unknown error.")}
        </p>
        <Link to="/payouts" className="mt-4 inline-block rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper">
          Back to payouts
        </Link>
      </div>
    );
  }

  const { action, paypal, webhookEvents } = data;
  const tone = actionTone(action.status);

  return (
    <div className="space-y-4">
      <Link to="/payouts" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-graphite hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All payouts
      </Link>

      <div className="rounded-xl border border-mist/70 bg-paper">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-mist/60 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-steel">{action.paypalRef ?? action.id}</span>
              <StatusPill status={tone.status} label={tone.label} />
              {(action.riskFlags ?? []).map((r) => (
                <RiskChip key={r} type={riskType(r)} label={riskLabel(r)} />
              ))}
            </div>
            <h1 className="mt-2 text-[20px] font-semibold tracking-[-0.03em] text-ink">{action.payeeName}</h1>
            <p className="mt-0.5 break-words text-[12px] text-pewter">
              {action.payeePaypal} · {action.purpose}
            </p>
          </div>
          <div className="text-right">
            <Money amount={action.amount} currency={action.currency} className="block text-[28px] font-semibold text-ink" />
            <p className="text-[11px] uppercase tracking-[0.1em] text-steel">single payout</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-xl border border-mist/80 px-3.5 py-2 text-[12.5px] font-medium text-ink hover:bg-fog"
          >
            Open approval trace
          </button>
          {action.emailId ? (
            <Link
              to="/requests/$requestId"
              params={{ requestId: action.emailId }}
              className="rounded-xl px-3 py-2 text-[12.5px] font-medium text-graphite hover:bg-fog"
            >
              Source email →
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-mist/70 bg-paper p-4">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">PayPal batch status</h2>
          {paypal?.available ? (
            <div className="mt-2">
              <p className="font-mono text-[12px] text-ink">{paypal.id}</p>
              <p className="mt-1 inline-block rounded-md bg-fog px-2 py-0.5 text-[11.5px] font-semibold text-ink">
                {paypal.status}
              </p>
              <p className="mt-2 text-[11px] text-pewter">Live from PayPal at page load.</p>
            </div>
          ) : (
            <p className="mt-2 text-[12px] leading-5 text-pewter">
              {paypal?.reason ?? "PayPal status unavailable."} Arkay's own record above stays the source of truth.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-mist/70 bg-paper p-4">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">Safety</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {action.policyVerdict ? (
              <span className="rounded-md bg-fog px-1.5 py-0.5 text-[11px] font-semibold text-ink">
                {action.policyVerdict}
              </span>
            ) : (
              <span className="text-[12px] text-pewter">No verdict recorded.</span>
            )}
          </div>
          {action.safetySummary ? (
            <p className="mt-2 text-[12px] leading-5 text-graphite">{action.safetySummary}</p>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-mist/70 bg-paper p-4">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">PayPal webhook events</h2>
        {(webhookEvents ?? []).length === 0 ? (
          <p className="mt-2 text-[12px] text-pewter">No webhook events recorded for this payout yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-mist/50">
            {(webhookEvents ?? []).map((w) => (
              <li key={w.id} className="flex items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11.5px] text-ink">{w.event}</p>
                  {summarizeJson(w.detail) ? (
                    <p className="mt-0.5 truncate font-mono text-[10.5px] text-steel">{summarizeJson(w.detail)}</p>
                  ) : null}
                </div>
                <span className="shrink-0 font-mono text-[10.5px] text-steel">{timeAgo(w.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ApprovalDrawer actionId={payoutId} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
