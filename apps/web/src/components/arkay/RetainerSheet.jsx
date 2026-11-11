import { useQuery } from "@tanstack/react-query";
import DetailSheet from "@/components/arkay/DetailSheet";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import RiskChip from "@/components/arkay/RiskChip";
import { billingSubscriptionDetailQuery } from "@/lib/queries";

function toneFor(status) {
  if (status === "ACTIVE") return { status: "executed", label: "Active" };
  if (status === "SUSPENDED") return { status: "pending", label: "Suspended" };
  if (status === "APPROVAL_PENDING" || status === "APPROVED")
    return { status: "approved", label: "Pending approval" };
  return { status: "ignored", label: status?.toLowerCase() ?? "Unknown" };
}

const FLAG_CHIPS = {
  FAILED_PAYMENTS: { type: "duplicate", label: "Payments failing" },
  PAST_DUE: { type: "amount_anomaly", label: "Past due" },
  SUSPENDED: { type: "urgency", label: "Suspended" },
  STALE_ACTIVE: { type: "note", label: "Stale" },
};

function flagChip(flag) {
  return FLAG_CHIPS[flag] ?? { type: "note", label: flag };
}

function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function RetainerSheet({ subscriptionId, open, onOpenChange }) {
  const detail = useQuery({
    ...billingSubscriptionDetailQuery(subscriptionId),
    enabled: open && Boolean(subscriptionId),
  });
  const sub = detail.data;
  const tone = toneFor(sub?.status);

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={sub?.subscriberName || sub?.subscriberEmail || "Subscription"}
    >
      {detail.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load subscription: {detail.error?.message ?? "unknown error"}
        </div>
      ) : detail.isLoading || !sub ? (
        <div className="h-40 animate-pulse rounded-xl bg-fog" />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">
                {sub.subscriberName || sub.subscriberEmail || sub.id}
              </h1>
              <p className="mt-1 font-mono text-[11px] text-steel">{sub.id}</p>
            </div>
            <StatusPill status={tone.status} label={tone.label} />
          </header>

          {sub.assessment?.flags?.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {sub.assessment.flags.map((flag) => (
                <RiskChip key={flag} {...flagChip(flag)} />
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Last payment</p>
              {sub.lastPaymentAmount && sub.lastPaymentCurrency ? (
                <Money amount={sub.lastPaymentAmount} currency={sub.lastPaymentCurrency} className="mt-0.5 text-[15px] text-ink" />
              ) : (
                <p className="mt-0.5 text-[15px] text-steel">—</p>
              )}
              <p className="text-[11px] text-pewter">{fmtDate(sub.lastPaymentTime)}</p>
            </div>
            <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Next billing</p>
              <p className="mt-0.5 text-[15px] font-medium text-ink">{fmtDate(sub.nextBillingTime)}</p>
            </div>
            <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Failed payments</p>
              <p className="mt-0.5 text-[15px] font-semibold tabular text-ink">{sub.failedPaymentsCount ?? 0}</p>
            </div>
            <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Outstanding</p>
              {sub.outstandingBalance && sub.outstandingCurrency ? (
                <Money amount={sub.outstandingBalance} currency={sub.outstandingCurrency} className="mt-0.5 text-[15px] text-ink" />
              ) : (
                <p className="mt-0.5 text-[15px] text-steel">—</p>
              )}
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
            <h2 className="border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">
              Transactions · last 90 days
            </h2>
            {sub.transactions === "unavailable" ? (
              <p className="px-4 py-6 text-center text-[12px] text-pewter">Transaction history is unavailable for this subscription.</p>
            ) : (sub.transactions ?? []).length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-pewter">No transactions in the last 90 days.</p>
            ) : (
              <ul className="divide-y divide-mist/50">
                {(sub.transactions ?? []).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink">{t.status?.toLowerCase() ?? "—"}</p>
                      <p className="font-mono text-[10px] text-steel">{t.id}</p>
                    </div>
                    <div className="text-right">
                      {t.amount && t.currency ? (
                        <Money amount={t.amount} currency={t.currency} className="text-[12.5px] text-ink" />
                      ) : null}
                      <p className="text-[11px] text-pewter">{fmtDate(t.time)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-[11.5px] text-pewter">
            To cancel, suspend or resume this subscription, ask Arkay in chat — every change needs your approval first.
          </p>
        </>
      )}
    </DetailSheet>
  );
}
