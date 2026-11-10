import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import { billingDisputesQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/disputes")({
  head: () => ({ meta: [{ title: "Disputes · Arkay" }] }),
  component: DisputesPage,
});

const FILTERS = [
  { label: "All", value: null },
  { label: "Needs you", value: "REQUIRED_ACTION" },
  { label: "Under review", value: "UNDER_PAYPAL_REVIEW" },
  { label: "Resolved", value: "RESOLVED" },
];

function toneFor(dispute) {
  if (dispute.state === "REQUIRED_ACTION" || dispute.status === "WAITING_FOR_SELLER_RESPONSE")
    return { status: "pending", label: "Needs you" };
  if (dispute.state === "UNDER_PAYPAL_REVIEW" || dispute.status === "UNDER_REVIEW")
    return { status: "approved", label: "Under review" };
  if (dispute.state === "RESOLVED" || dispute.status === "RESOLVED")
    return { status: "executed", label: "Resolved" };
  return { status: "ignored", label: dispute.state?.toLowerCase() ?? "Open" };
}

function DisputesPage() {
  const [stateFilter, setStateFilter] = useState(null);
  const list = useQuery(billingDisputesQuery(stateFilter));
  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Disputes</h1>
        <p className="mt-1 text-[12.5px] text-pewter">
          Buyer claims filed against you, live from PayPal.
          {rows.length > 0 ? ` · ${rows.length} shown` : ""}
        </p>
      </header>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setStateFilter(f.value)}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              stateFilter === f.value ? "bg-ink text-paper" : "bg-paper text-graphite ring-1 ring-inset ring-mist/70 hover:text-ink",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load disputes: {list.error?.message ?? "unknown error"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">No disputes here</p>
          <p className="mt-1 text-[12px] text-pewter">Buyer claims appear here the moment PayPal opens one.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_130px_96px] gap-3 border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel md:grid">
            <span>Dispute</span>
            <span className="text-right">Amount</span>
            <span>Updated</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-mist/50">
            {rows.map((row) => {
              const tone = toneFor(row);
              return (
                <li key={row.id}>
                  <Link
                    to="/disputes/$disputeId"
                    params={{ disputeId: row.id }}
                    className="grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-fog/50 md:grid-cols-[minmax(0,1fr)_110px_130px_96px] md:items-center md:gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {row.buyerName ? `${row.buyerName} · ` : ""}{row.reasonText ?? "Dispute"}
                      </p>
                      <p className="truncate font-mono text-[10px] text-steel">{row.id}</p>
                    </div>
                    <div className="md:text-right">
                      {row.amount && row.currency ? (
                        <Money amount={row.amount} currency={row.currency} className="text-[13px] text-ink" />
                      ) : (
                        <span className="text-[11.5px] text-steel">—</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[11.5px] text-steel">
                        {row.updateTime
                          ? new Date(row.updateTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : "—"}
                      </span>
                    </div>
                    <div className="md:text-right">
                      <StatusPill status={tone.status} label={tone.label} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
