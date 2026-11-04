import { Check, PencilLine, X, Fingerprint, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import StatusPill from "@/components/arkay/StatusPill";
import RiskChip from "@/components/arkay/RiskChip";
import Money from "@/components/arkay/Money";
import { expiryText, riskLabel, riskType } from "@/lib/actionShapes";

function chipFor(flag) {
  // Demo drafts carry lowercase chip types already; the API sends UPPER_SNAKE flags.
  if (flag === String(flag).toLowerCase()) return { type: flag, label: undefined };
  return { type: riskType(flag), label: riskLabel(flag) };
}

export default function ApprovalCard({
  request,
  selected,
  onApprove,
  onEdit,
  onIgnore,
  onOpen,
  primary,
  hint,
  busy,
  compact,
}) {
  const local = Boolean(request.local);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-paper transition-all",
        selected ? "border-ink/70 ring-1 ring-ink/10" : "border-mist/70",
      )}
    >
      {selected ? <span className="absolute inset-y-0 left-0 w-[3px] bg-ember" /> : null}

      <div className={cn("flex flex-wrap items-center justify-between gap-2 border-b border-mist/50 px-4 py-2.5", selected && "pl-5")}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-fog px-1.5 py-0.5 font-mono text-[10.5px] text-graphite">{request.source}</span>
          <span className="truncate font-mono text-[10.5px] text-steel">{request.id}</span>
          <span className="shrink-0 text-[11px] text-pewter" title={request.receivedTitle}>{request.receivedAt}</span>
        </div>
        <StatusPill status={request.status} label={request.statusLabel} />
      </div>

      <div className={cn("px-4 py-4", selected && "pl-5")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">{request.sender.name}</p>
            <p className="truncate text-[11.5px] text-pewter">{request.sender.email}</p>
          </div>
          <div className="shrink-0 text-right">
            <Money amount={request.amount} currency={request.currency} className="block text-[20px] font-semibold text-ink" />
            <p className="text-[10.5px] uppercase tracking-[0.1em] text-steel">{request.type}</p>
          </div>
        </div>

        <p className="mt-3 text-[12.5px] leading-5 text-graphite">{request.purpose}</p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(request.risks ?? []).map((r) => {
            const chip = chipFor(r);
            return <RiskChip key={r} type={chip.type} label={chip.label} />;
          })}
          {request.confidence != null ? (
            <span className="text-[10.5px] text-steel">confidence {request.confidence}%</span>
          ) : null}
          {request.expiresAt ? (
            <span
              className="text-[10.5px] text-steel"
              title={new Date(request.expiresAt).toLocaleString()}
            >
              {expiryText(request.expiresAt)}
            </span>
          ) : null}
        </div>

        {request.paypalRef ? (
          <p className="mt-2 truncate font-mono text-[10.5px] text-emerald-700">PayPal · {request.paypalRef}</p>
        ) : null}

        {(request.hash || request.idempotency) && (
          <div className="mt-3 flex items-center gap-1.5 border-t border-mist/50 pt-2.5 font-mono text-[10px] text-steel">
            <Fingerprint className="h-3 w-3 shrink-0" />
            <span className="truncate">{request.hash ?? "—"}</span>
            {request.idempotency ? <span className="ml-auto shrink-0">idem {request.idempotency}</span> : null}
          </div>
        )}

        {!compact ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {local ? (
                <button
                  type="button"
                  onClick={() => onApprove?.(request)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-[12.5px] font-semibold text-paper transition-opacity hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} /> Approve
                </button>
              ) : primary ? (
                <button
                  type="button"
                  onClick={() => primary.onClick?.(request)}
                  disabled={primary.disabled || busy}
                  className="inline-flex flex-[1.3] items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-[12.5px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}{" "}
                  {primary.label}
                </button>
              ) : null}
              {onEdit && !local ? (
                <button
                  type="button"
                  onClick={() => onEdit?.(request)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-mist/80 px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-fog"
                >
                  <PencilLine className="h-3.5 w-3.5" /> Edit
                </button>
              ) : null}
              {local ? (
                <button
                  type="button"
                  onClick={() => onEdit?.(request)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-mist/80 px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-fog"
                >
                  <PencilLine className="h-3.5 w-3.5" /> Edit
                </button>
              ) : null}
              {onIgnore ? (
                <button
                  type="button"
                  onClick={() => onIgnore?.(request)}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-steel transition-colors hover:bg-fog disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Ignore
                </button>
              ) : null}
              {onOpen && !local ? (
                <button
                  type="button"
                  onClick={() => onOpen?.(request)}
                  className="ml-auto inline-flex items-center gap-0.5 rounded-xl px-2 py-2 text-[12px] font-medium text-graphite transition-colors hover:bg-fog"
                >
                  Details <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {hint && !local ? <p className="mt-2 text-[11px] leading-4 text-pewter">{hint}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
