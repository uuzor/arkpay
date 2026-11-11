import { useQuery } from "@tanstack/react-query";
import DetailSheet from "@/components/arkay/DetailSheet";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import { billingDisputeDetailQuery } from "@/lib/queries";

const SUGGESTIONS = {
  send_message: "Reply to the buyer",
  make_offer: "Make an offer",
  provide_evidence: "Submit evidence",
  accept_claim: "Accept the claim",
  wait_paypal: "Wait for PayPal",
  none: "No action available",
};

function toneFor(dispute) {
  if (dispute?.state === "REQUIRED_ACTION" || dispute?.status === "WAITING_FOR_SELLER_RESPONSE")
    return { status: "pending", label: "Needs you" };
  if (dispute?.state === "UNDER_PAYPAL_REVIEW" || dispute?.status === "UNDER_REVIEW")
    return { status: "approved", label: "Under review" };
  if (dispute?.state === "RESOLVED" || dispute?.status === "RESOLVED")
    return { status: "executed", label: "Resolved" };
  return { status: "ignored", label: "Open" };
}

function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DisputeSheet({ disputeId, open, onOpenChange }) {
  const detail = useQuery({
    ...billingDisputeDetailQuery(disputeId),
    enabled: open && Boolean(disputeId),
  });
  const d = detail.data;
  const tone = toneFor(d);

  return (
    <DetailSheet open={open} onOpenChange={onOpenChange} title={d?.reasonText ?? "Dispute"}>
      {detail.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load dispute: {detail.error?.message ?? "unknown error"}
        </div>
      ) : detail.isLoading || !d ? (
        <div className="h-40 animate-pulse rounded-xl bg-fog" />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">
                {d.reasonText ?? "Dispute"}
              </h1>
              <p className="mt-1 font-mono text-[11px] text-steel">{d.id}</p>
            </div>
            <StatusPill status={tone.status} label={tone.label} />
          </header>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Amount</p>
              {d.amount && d.currency ? (
                <Money amount={d.amount} currency={d.currency} className="mt-0.5 text-[15px] text-ink" />
              ) : (
                <p className="mt-0.5 text-[15px] text-steel">—</p>
              )}
            </div>
            <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Buyer</p>
              <p className="mt-0.5 truncate text-[15px] font-medium text-ink">{d.buyerName ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Stage</p>
              <p className="mt-0.5 text-[15px] font-medium text-ink">{d.lifeCycleStage ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-mist/70 bg-paper px-3 py-2.5">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">Suggested next step</p>
              <p className="mt-0.5 text-[15px] font-medium text-ink">
                {SUGGESTIONS[d.assessment?.suggestion] ?? "—"}
              </p>
            </div>
          </div>

          {d.assessment?.reason ? (
            <p className="text-[12.5px] text-pewter">{d.assessment.reason}</p>
          ) : null}

          <section className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
            <h2 className="border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">
              Messages
            </h2>
            {(d.messages ?? []).length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-pewter">No messages yet.</p>
            ) : (
              <ul className="divide-y divide-mist/50">
                {(d.messages ?? []).map((m, i) => (
                  <li key={i} className="px-4 py-2.5">
                    <p className="text-[11px] font-medium text-steel">
                      {m.postedBy === "SELLER" ? "You" : "Buyer"} · {fmtDate(m.time)}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink">{m.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
            <h2 className="border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel">
              Evidence
            </h2>
            {(d.evidences ?? []).length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-pewter">No evidence submitted yet.</p>
            ) : (
              <ul className="divide-y divide-mist/50">
                {(d.evidences ?? []).map((e, i) => (
                  <li key={i} className="px-4 py-2.5">
                    <p className="text-[11px] font-medium text-steel">
                      {e.type} · {e.source === "SUBMITTED_BY_SELLER" ? "You" : "Buyer"} · {fmtDate(e.date)}
                    </p>
                    {e.notes ? <p className="mt-0.5 text-[12.5px] text-ink">{e.notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-[11.5px] text-pewter">
            To reply, offer, submit evidence or accept this claim, ask Arkay in chat — the exact text goes on an approval card first.
          </p>
        </>
      )}
    </DetailSheet>
  );
}
