import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Fingerprint, Loader2, PencilLine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import StatusPill from "@/components/arkay/StatusPill";
import RiskChip from "@/components/arkay/RiskChip";
import Timeline from "@/components/arkay/Timeline";
import Money from "@/components/arkay/Money";
import {
  adaptAction,
  expiryText,
  hintFor,
  primaryFor,
  riskLabel,
  riskType,
  timeAgo,
} from "@/lib/actionShapes";
import { actionTraceQuery } from "@/lib/queries";

function summarizeDetail(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail.slice(0, 160);
  if (typeof detail === "object") {
    const d = detail;
    const pick = d.reason ?? d.status ?? d.via ?? d.error ?? d.message;
    if (typeof pick === "string") return pick.slice(0, 160);
    try {
      return JSON.stringify(d).slice(0, 160);
    } catch {
      return "";
    }
  }
  return String(detail).slice(0, 160);
}

const VERDICT_CLS = {
  ALLOW: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  NEEDS_CONFIRMATION: "bg-amber-50 text-amber-800 ring-amber-200",
  BLOCK: "bg-red-50 text-red-700 ring-red-200",
};

function timeOf(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function ApprovalDrawer({
  actionId,
  open,
  onOpenChange,
  onPrimary,
  onEdit,
  onIgnore,
  busy,
}) {
  const { data: trace, isLoading, isError } = useQuery({
    ...actionTraceQuery(actionId),
    enabled: open && Boolean(actionId),
  });

  const action = trace ? adaptAction(trace) : null;
  const primary = action ? primaryFor(action) : null;
  const hint = action ? hintFor(action) : null;
  const email = trace?.email ?? null;
  const contact = trace?.contact ?? null;
  const audit = trace?.audit ?? [];
  const emailChanged =
    contact?.paypalEmail &&
    action?.payeePaypal &&
    contact.paypalEmail.toLowerCase() !== action.payeePaypal.toLowerCase();

  const timeline = audit.map((row, i) => ({
    time: timeOf(row.createdAt),
    title: String(row.event).replace(/_/g, " ").toLowerCase(),
    detail: summarizeDetail(row.detail),
    state:
      row.event === "BLOCKED" || row.event === "EXECUTION_REFUSED"
        ? "blocked"
        : i === audit.length - 1 && action?.rawStatus === "PENDING_APPROVAL"
          ? "current"
          : "done",
  }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[440px]">
        {isLoading || !action ? (
          <div className="space-y-3 p-5">
            <div className="h-8 w-2/3 animate-pulse rounded-lg bg-fog" />
            <div className="h-24 animate-pulse rounded-xl bg-fog" />
            <div className="h-48 animate-pulse rounded-xl bg-fog" />
          </div>
        ) : isError ? (
          <div className="p-5">
            <p className="text-[13px] font-medium text-ink">Could not load this action</p>
            <p className="mt-1 text-[12px] text-pewter">It may belong to another workspace.</p>
          </div>
        ) : (
          <>
            <SheetHeader className="border-b border-mist/60 p-5 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-fog px-1.5 py-0.5 font-mono text-[10.5px] text-graphite">{action.source}</span>
                <span className="truncate font-mono text-[10.5px] text-steel">{action.id}</span>
                <span className="ml-auto">
                  <StatusPill status={action.status} label={action.statusLabel} />
                </span>
              </div>
              <SheetTitle className="mt-2 text-[18px] tracking-[-0.02em]">
                {action.sender.name} · <Money amount={action.amount} currency={action.currency} />
              </SheetTitle>
              <SheetDescription className="text-[12.5px] text-graphite">
                {action.type} · {action.purpose}
              </SheetDescription>
              {action.expiresAt ? (
                <p className="mt-1 text-[11px] text-steel" title={new Date(action.expiresAt).toLocaleString()}>
                  {expiryText(action.expiresAt)}
                </p>
              ) : null}
            </SheetHeader>

            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                {primary ? (
                  <button
                    type="button"
                    onClick={() => onPrimary?.(action)}
                    disabled={busy}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}{" "}
                    {primary.label}
                  </button>
                ) : null}
                {action.rawType !== "PAYOUT_BATCH" &&
                (action.rawStatus === "PENDING_APPROVAL" || action.rawStatus === "APPROVED") ? (
                  <button
                    type="button"
                    onClick={() => onEdit?.(action)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-mist/80 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-fog"
                  >
                    <PencilLine className="h-3.5 w-3.5" /> Edit
                  </button>
                ) : null}
                {action.rawStatus === "PENDING_APPROVAL" ? (
                  <button
                    type="button"
                    onClick={() => onIgnore?.(action)}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-steel hover:bg-fog disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> Ignore
                  </button>
                ) : null}
              </div>
              {hint ? <p className="-mt-2 text-[11.5px] leading-5 text-pewter">{hint}</p> : null}

              <div className="rounded-xl border border-mist/70 bg-paper p-4">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">Source</h3>
                {email ? (
                  <div className="mt-2">
                    <p className="break-words text-[12px] text-pewter">{email.from} · {email.subject}</p>
                    <p className="mt-1.5 border-l-2 border-mist pl-2.5 text-[12.5px] italic leading-5 text-graphite">
                      “{String(email.body ?? "").replace(/\s+/g, " ").trim().slice(0, 400)}”
                    </p>
                    <Link
                      to="/requests/$requestId"
                      params={{ requestId: email.id }}
                      className="mt-2 inline-block text-[12px] font-medium text-ink hover:underline"
                    >
                      Open email →
                    </Link>
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-pewter">Created in agent chat — no source email.</p>
                )}
              </div>

              <div className="rounded-xl border border-mist/70 bg-paper p-4">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">Safety</h3>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {action.policyVerdict ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                        VERDICT_CLS[action.policyVerdict] ?? "bg-fog text-graphite ring-mist/70",
                      )}
                    >
                      {action.policyVerdict}
                    </span>
                  ) : null}
                  {(action.risks ?? []).map((r) => (
                    <RiskChip key={r} type={riskType(r)} label={riskLabel(r)} />
                  ))}
                  {action.confidence != null && action.confidence < 80 ? (
                    <span className="text-[11px] font-medium text-amber-800">Low confidence · {action.confidence}%</span>
                  ) : null}
                </div>
                {action.safetySummary ? (
                  <p className="mt-2 text-[12px] leading-5 text-graphite">{action.safetySummary}</p>
                ) : null}
                {emailChanged ? (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11.5px] font-medium text-red-700 ring-1 ring-inset ring-red-100">
                    PayPal email changed: was {contact.paypalEmail}, now {action.payeePaypal}.
                  </p>
                ) : null}
              </div>

              <div className="rounded-xl border border-mist/70 bg-paper p-4">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">Contact</h3>
                {contact ? (
                  <div className="mt-2 space-y-1.5 text-[12px] text-graphite">
                    <div className="flex justify-between"><span>Name</span><strong className="text-ink">{contact.name}</strong></div>
                    <div className="flex justify-between"><span>Type</span><strong className="text-ink">{contact.kind}</strong></div>
                    <div className="flex justify-between"><span>Prior payments</span><strong className="text-ink">{contact.payCount}</strong></div>
                    <div className="flex justify-between">
                      <span>Usual amount</span>
                      <strong className="text-ink">
                        {contact.usualAmount != null ? <Money amount={contact.usualAmount} currency={contact.currency} /> : "—"}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Last paid</span>
                      <strong className="text-ink">{contact.lastPaidAt ? timeAgo(contact.lastPaidAt) : "never"}</strong>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-pewter">No saved contact for this payee.</p>
                )}
              </div>

              <div className="rounded-xl border border-mist/70 bg-paper p-4">
                <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">Audit trail</h3>
                <div className="mt-3">
                  {timeline.length ? <Timeline items={timeline} /> : <p className="text-[12px] text-pewter">No audit events yet.</p>}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-xl bg-fog/70 p-3">
                <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0 text-steel" />
                <p className="break-all font-mono text-[10.5px] leading-5 text-graphite">
                  {action.hash ?? "—"}
                  {action.idempotency ? <span className="block">idem {action.idempotency}</span> : null}
                </p>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
