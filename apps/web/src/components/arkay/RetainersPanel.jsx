import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import { billingSubscriptionsQuery } from "@/lib/queries";

const FILTERS = [
  { label: "All", value: null },
  { label: "Active", value: "ACTIVE" },
  { label: "Suspended", value: "SUSPENDED" },
  { label: "Cancelled", value: "CANCELLED" },
];

function toneFor(status) {
  if (status === "ACTIVE") return { status: "executed", label: "Active" };
  if (status === "SUSPENDED") return { status: "pending", label: "Suspended" };
  if (status === "APPROVAL_PENDING" || status === "APPROVED")
    return { status: "approved", label: "Pending approval" };
  return { status: "ignored", label: status?.toLowerCase() ?? "Unknown" };
}

export default function RetainersPanel({ onSelectSubscription, selectedSubscriptionId }) {
  const [statusFilter, setStatusFilter] = useState(null);
  const list = useQuery(billingSubscriptionsQuery(statusFilter));
  const rows = list.data?.rows ?? [];
  const report = list.data?.report;

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-pewter">
        Recurring billing your customers pay you, live from PayPal.
        {typeof report?.total === "number" ? ` · ${report.total} total` : ""}
      </p>

      {report && report.total > 0 ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {Object.entries(report.activeMrr ?? {}).map(([currency, value]) => (
            <div key={currency} className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Active MRR</p>
              <Money amount={value} currency={currency} className="mt-0.5 text-[16px] text-ink" />
            </div>
          ))}
          {Object.entries(report.pastDueTotal ?? {}).map(([currency, value]) => (
            <div key={`due-${currency}`} className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Past due</p>
              <Money amount={value} currency={currency} className="mt-0.5 text-[16px] text-ink" />
            </div>
          ))}
          <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">At risk</p>
            <p className="mt-0.5 text-[16px] font-semibold tabular text-ink">{report.atRisk?.length ?? 0}</p>
          </div>
          <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Healthy</p>
            <p className="mt-0.5 text-[16px] font-semibold tabular text-ink">{report.healthy ?? 0}</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              statusFilter === f.value ? "bg-ink text-paper" : "bg-paper text-graphite ring-1 ring-inset ring-mist/70 hover:text-ink",
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
          Could not load subscriptions: {list.error?.message ?? "unknown error"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">No subscriptions here</p>
          <p className="mt-1 text-[12px] text-pewter">Customer subscriptions from PayPal appear here once they exist.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_130px_96px] gap-3 border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel md:grid">
            <span>Subscriber</span>
            <span className="text-right">Last payment</span>
            <span>Next billing</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-mist/50">
            {rows.map((row) => {
              const tone = toneFor(row.status);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onSelectSubscription?.(row.id)}
                    className={cn(
                      "grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-fog/50 md:grid-cols-[minmax(0,1fr)_110px_130px_96px] md:items-center md:gap-3",
                      selectedSubscriptionId === row.id && "bg-fog/60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {row.subscriberName || row.subscriberEmail || row.id}
                      </p>
                      <p className="truncate font-mono text-[10px] text-steel">{row.id}</p>
                      {row.failedPaymentsCount > 0 ? (
                        <p className="text-[11px] font-medium text-red-700">
                          {row.failedPaymentsCount} failed payment{row.failedPaymentsCount === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </div>
                    <div className="md:text-right">
                      {row.lastPaymentAmount && row.lastPaymentCurrency ? (
                        <Money amount={row.lastPaymentAmount} currency={row.lastPaymentCurrency} className="text-[13px] text-ink" />
                      ) : (
                        <span className="text-[11.5px] text-steel">—</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[11.5px] text-steel">
                        {row.nextBillingTime
                          ? new Date(row.nextBillingTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : "—"}
                      </span>
                    </div>
                    <div className="md:text-right">
                      <StatusPill status={tone.status} label={tone.label} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
