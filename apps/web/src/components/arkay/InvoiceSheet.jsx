import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DetailSheet from "@/components/arkay/DetailSheet";
import StatusPill from "@/components/arkay/StatusPill";
import RiskChip from "@/components/arkay/RiskChip";
import Money from "@/components/arkay/Money";
import ApprovalDrawer from "@/components/arkay/ApprovalDrawer";
import { actionTone, riskLabel, riskType, summarizeJson, timeAgo } from "@/lib/actionShapes";
import { invoiceDetailQuery } from "@/lib/queries";

export default function InvoiceSheet({ invoiceId, open, onOpenChange }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    ...invoiceDetailQuery(invoiceId),
    enabled: open && Boolean(invoiceId),
  });

  if (isLoading) {
    return (
      <DetailSheet open={open} onOpenChange={onOpenChange} title="Invoice">
        <div className="h-36 animate-pulse rounded-xl bg-fog" />
        <div className="h-64 animate-pulse rounded-xl bg-fog" />
      </DetailSheet>
    );
  }

  if (isError || !data?.action) {
    const notFound = error?.status === 404;
    return (
      <DetailSheet open={open} onOpenChange={onOpenChange} title="Invoice">
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-12 text-center">
          <p className="text-[14px] font-semibold text-ink">{notFound ? "Invoice not found" : "Could not load this invoice"}</p>
          <p className="mt-1 text-[12px] text-pewter">
            {notFound ? "It may belong to another workspace." : (error?.message ?? "Unknown error.")}
          </p>
        </div>
      </DetailSheet>
    );
  }

  const { action, paypal, reminders, webhookEvents } = data;
  const tone = actionTone(action.status);

  return (
    <DetailSheet open={open} onOpenChange={onOpenChange} title={action.paypalRef ?? "Invoice"}>
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
            <p className="text-[11px] uppercase tracking-[0.1em] text-steel">
              due {action.dueDate ? new Date(action.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
            </p>
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
          {action.email ? (
            <span className="px-3 py-2 text-[12px] text-pewter">
              Source: {action.email.from} — {action.email.subject}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-mist/70 bg-paper p-4">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">PayPal status</h2>
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
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">Reminders</h2>
          {(reminders ?? []).length === 0 ? (
            <p className="mt-2 text-[12px] text-pewter">No reminders sent yet — the scheduler chases overdue invoices automatically.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {(reminders ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-[12px] text-graphite">
                  <span>Reminder sent</span>
                  <span className="font-mono text-[10.5px] text-steel">{timeAgo(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-mist/70 bg-paper p-4">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">PayPal webhook events</h2>
        {(webhookEvents ?? []).length === 0 ? (
          <p className="mt-2 text-[12px] text-pewter">No webhook events recorded for this invoice yet.</p>
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

      <ApprovalDrawer actionId={invoiceId} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </DetailSheet>
  );
}
