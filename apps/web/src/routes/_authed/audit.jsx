import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import ApprovalDrawer from "@/components/arkay/ApprovalDrawer";
import { ACTION_STATUS_FILTERS, actionTone, actionTypeLabel, summarizeJson } from "@/lib/actionShapes";
import { auditRecentQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/audit")({
  head: () => ({ meta: [{ title: "Activity · Arkay" }] }),
  component: AuditPage,
});

function actorOf(row) {
  const latest = row.audit?.[0]?.detail;
  if (latest && typeof latest === "object") {
    const by = latest.by ?? latest.via ?? latest.actor;
    if (typeof by === "string" && by) return by;
  }
  return "system";
}

function timeParts(value) {
  const d = new Date(value);
  return {
    time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

function AuditPage() {
  const [statusFilter, setStatusFilter] = useState(null);
  const [eventFilter, setEventFilter] = useState("");
  const [openId, setOpenId] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const { data, isLoading, isError, error } = useQuery(auditRecentQuery(50));

  const q = eventFilter.trim().toLowerCase();
  const rows = (data ?? []).filter((row) => {
    if (statusFilter && row.status !== statusFilter) return false;
    if (q && !(row.audit ?? []).some((e) => String(e.event).toLowerCase().includes(q))) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Activity</h1>
          <p className="mt-1 text-[12.5px] text-pewter">
            Everything Arkay did, newest first — reads, flags, decisions and PayPal results, including the ones that never moved money.
          </p>
        </div>
        <span className="rounded-md bg-fog px-2 py-1 font-mono text-[10.5px] text-graphite">
          {(data ?? []).length} recent actions
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {ACTION_STATUS_FILTERS.map((f) => (
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
        <input
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          placeholder="Filter by event (e.g. WEBHOOK, BLOCKED)"
          className="ml-auto h-8 w-full rounded-lg border border-mist/80 bg-paper px-2.5 text-[12px] text-ink outline-none placeholder:text-steel focus:border-ink/40 sm:w-[260px]"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load the audit trail: {error?.message ?? "unknown error"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">Nothing here</p>
          <p className="mt-1 text-[12px] text-pewter">No actions match these filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
          <div className="hidden grid-cols-[70px_minmax(0,1.6fr)_100px_100px_96px_20px] gap-3 border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel md:grid">
            <span>Time</span>
            <span>Event</span>
            <span>Actor</span>
            <span className="text-right">Amount</span>
            <span className="text-right">State</span>
            <span />
          </div>
          <ul className="divide-y divide-mist/50">
            {rows.map((row) => {
              const open = openId === row.id;
              const tone = actionTone(row.status);
              const { time, day } = timeParts(row.createdAt);
              const latest = row.audit?.[0];
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : row.id)}
                    className="grid w-full grid-cols-1 gap-2 px-4 py-2.5 text-left transition-colors hover:bg-fog/40 md:grid-cols-[70px_minmax(0,1.6fr)_100px_100px_96px_20px] md:items-center md:gap-3"
                  >
                    <div className="font-mono text-[10.5px] text-steel">
                      <p className="text-graphite">{time}</p>
                      <p className="text-steel">{day}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-ink">
                        {actionTypeLabel(row.type)} · {row.payeeName} · {row.purpose}
                      </p>
                      <p className="truncate font-mono text-[10.5px] text-pewter">
                        {latest ? String(latest.event).toLowerCase() : "no events"} · {row.id}
                      </p>
                    </div>
                    <div>
                      <span className="rounded-md bg-fog px-1.5 py-0.5 text-[10px] font-medium text-graphite">{actorOf(row)}</span>
                    </div>
                    <div className="md:text-right">
                      <Money amount={row.amount} currency={row.currency} className="text-[12.5px] text-ink" />
                    </div>
                    <div className="md:text-right">
                      <StatusPill status={tone.status} label={tone.label} />
                    </div>
                    <ChevronDown className={cn("h-3.5 w-3.5 text-steel transition-transform", open && "rotate-180")} />
                  </button>

                  {open ? (
                    <div className="space-y-1.5 border-t border-mist/40 bg-fog/40 px-4 py-3">
                      {(row.audit ?? []).length === 0 ? (
                        <p className="text-[12px] text-pewter">No audit events on this action yet.</p>
                      ) : (
                        (row.audit ?? []).map((e, i) => (
                          <div key={`${e.event}-${i}`} className="flex items-baseline justify-between gap-3">
                            <p className="min-w-0 truncate font-mono text-[11px] text-ink">
                              {e.event}
                              {summarizeJson(e.detail) ? (
                                <span className="ml-2 text-steel">{summarizeJson(e.detail)}</span>
                              ) : null}
                            </p>
                            <span className="shrink-0 font-mono text-[10px] text-steel">
                              {new Date(e.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        ))
                      )}
                      <button
                        type="button"
                        onClick={() => setDrawerId(row.id)}
                        className="pt-1 text-[12px] font-medium text-ink hover:underline"
                      >
                        Open full trace →
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ApprovalDrawer actionId={drawerId} open={Boolean(drawerId)} onOpenChange={(v) => !v && setDrawerId(null)} />
    </div>
  );
}
