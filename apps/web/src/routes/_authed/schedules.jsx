import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Play, Pause, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import Money from "@/components/arkay/Money";
import StatusPill from "@/components/arkay/StatusPill";
import NewScheduleDialog from "@/components/arkay/NewScheduleDialog";
import { kindLabel, runTone, scheduleTone, summarizeJson, timeAgo, triggerLabel } from "@/lib/actionShapes";
import { contactsQuery, payrollDetailQuery, payrollRunsQuery, scheduleRunsQuery, schedulesQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/schedules")({
  head: () => ({ meta: [{ title: "Schedules · Arkay" }] }),
  component: SchedulesPage,
});

function RunHistory({ scheduleId }) {
  const runs = useQuery(scheduleRunsQuery(scheduleId));
  if (runs.isLoading) return <div className="h-16 animate-pulse rounded-lg bg-fog" />;
  if (runs.isError) return <p className="text-[12px] text-red-700">Could not load runs: {runs.error?.message}</p>;
  const rows = runs.data ?? [];
  if (!rows.length) return <p className="text-[12px] text-pewter">Never run.</p>;
  return (
    <ul className="divide-y divide-mist/50 rounded-lg border border-mist/60 bg-paper">
      {rows.map((run) => {
        const tone = runTone(run.status);
        return (
          <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
            <span className="font-mono text-[10.5px] text-steel">{timeAgo(run.startedAt)}</span>
            <span className="rounded-md bg-fog px-1.5 py-0.5 text-[10px] font-medium text-graphite">{run.trigger}</span>
            <StatusPill status={tone.status} label={tone.label} />
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-steel">
              {run.error ? `error: ${run.error}` : summarizeJson(run.result) || "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PayrollScheduleDetail() {
  const runs = useQuery(payrollRunsQuery);
  const latest = runs.data?.[0] ?? null;
  const detail = useQuery({ ...payrollDetailQuery(latest?.period), enabled: !!latest?.period });
  const staff = useQuery({ ...contactsQuery("STAFF"), enabled: !runs.isLoading && !latest });

  if (runs.isLoading) return <div className="h-16 animate-pulse rounded-lg bg-fog" />;
  if (runs.isError) return <p className="text-[12px] text-red-700">Could not load payroll: {runs.error?.message}</p>;
  if (!latest) {
    const roster = staff.data ?? [];
    return (
      <div className="text-[12px] text-graphite">
        <p>No payroll prepared yet — press Run to prepare the current month.</p>
        {staff.isLoading ? (
          <div className="mt-2 h-10 animate-pulse rounded-lg bg-fog" />
        ) : roster.length > 0 ? (
          <>
            <p className="mt-2 font-medium text-ink">Next run will pay {roster.length} staffer{roster.length === 1 ? "" : "s"}:</p>
            <ul className="mt-1 divide-y divide-mist/50 rounded-lg border border-mist/60 bg-paper">
              {roster.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <span className="truncate text-[12.5px] font-medium text-ink">{c.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-graphite">
                    {c.usualAmount != null ? <Money amount={c.usualAmount} currency={c.currency} /> : "no usual amount"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2">No STAFF contacts yet — add them on the Contacts page first.</p>
        )}
      </div>
    );
  }
  const members = detail.data?.members ?? [];
  return (
    <div>
      <p className="text-[12px] text-graphite">
        Latest prepared run: <span className="font-medium text-ink">{latest.period}</span> ·{" "}
        <Money amount={latest.totalAmount} currency={latest.currency} className="font-medium text-ink" /> ·{" "}
        {String(latest.status).toLowerCase()} · prepared {timeAgo(latest.preparedAt)} by {latest.preparedBy ?? "scheduler"}
      </p>
      {detail.isLoading ? (
        <div className="mt-2 h-16 animate-pulse rounded-lg bg-fog" />
      ) : (
        <ul className="mt-2 divide-y divide-mist/50 rounded-lg border border-mist/60 bg-paper">
          {members.map((m) => (
            <li key={m.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink">{m.payeeName}</span>
                <span className="block truncate font-mono text-[10.5px] text-steel">{m.payeePaypal}</span>
              </span>
              <span className="shrink-0 text-right">
                <Money amount={m.amount} currency={m.currency} className="block text-[12.5px] font-medium text-ink" />
                <span className="block text-[10.5px] text-steel">{String(m.status).toLowerCase().replace(/_/g, " ")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScheduleDetails({ schedule }) {
  const payload = schedule.payload ?? {};
  if (schedule.kind === "PAYROLL_PREPARE") {
    return (
      <div className="space-y-2">
        <p className="text-[12px] text-graphite">
          Each run prepares one monthly team payout from STAFF contacts and writes it as a payroll batch for approval. Nothing moves until the batch is approved.
        </p>
        <PayrollScheduleDetail />
      </div>
    );
  }
  if (schedule.kind === "INVOICE_REMINDERS") {
    return (
      <p className="text-[12px] text-graphite">
        Each run checks executed invoices and sends polite reminders at 3, 7 and 14 days overdue. Paid and cancelled invoices are skipped; every reminder is audited.
        {payload.days ? ` This schedule uses day ${payload.days}.` : ""}
      </p>
    );
  }
  if (schedule.kind === "NOTIFY") {
    return (
      <div className="text-[12px] text-graphite">
        <p>Each run sends this Telegram message:</p>
        <p className="mt-1 rounded-lg border border-mist/60 bg-paper px-3 py-2 text-[12.5px] text-ink">
          {typeof payload.text === "string" && payload.text.trim() ? payload.text : "(no message text configured)"}
        </p>
      </div>
    );
  }
  if (schedule.kind === "AGENT_TASK") {
    return (
      <div className="text-[12px] text-graphite">
        <p>Each run asks the agent (read-only — no drafts, no reminders, nothing saved):</p>
        <p className="mt-1 rounded-lg border border-mist/60 bg-paper px-3 py-2 font-mono text-[11px] text-ink">
          {schedule.detail?.trim() ? schedule.detail : "(no prompt configured)"}
        </p>
      </div>
    );
  }
  return (
    <p className="font-mono text-[11px] text-steel">
      {summarizeJson(payload, 400) || "No configuration."}
    </p>
  );
}

function ScheduleRow({ schedule, open, onToggle }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(null);
  const tone = scheduleTone(schedule.status);
  const lastRun = schedule.runs?.[0];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["schedules"] });

  const runNow = async () => {
    setBusy("run");
    try {
      const run = await apiJson(`/schedules/${encodeURIComponent(schedule.id)}/run`, { method: "POST" });
      toast("Run finished", { description: run?.status ?? "Done." });
      refresh();
    } catch (e) {
      toast("Run failed", { description: e?.message ?? "Could not run the schedule." });
    } finally {
      setBusy(null);
    }
  };

  const flip = async () => {
    const next = schedule.status === "PAUSED" ? "ACTIVE" : "PAUSED";
    setBusy("flip");
    try {
      await apiJson(`/schedules/${encodeURIComponent(schedule.id)}`, { method: "PATCH", body: { status: next } });
      toast(next === "PAUSED" ? "Schedule paused" : "Schedule resumed");
      refresh();
    } catch (e) {
      toast("Update failed", { description: e?.message ?? "Could not update the schedule." });
    } finally {
      setBusy(null);
    }
  };

  const canFlip = schedule.status === "ACTIVE" || schedule.status === "PAUSED";

  return (
    <li>
      <div className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px] md:items-center md:gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-[13px] font-medium text-ink">{schedule.title}</p>
            {schedule.kind === "AGENT_TASK" ? (
              <span className="rounded-md bg-fog px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-graphite ring-1 ring-inset ring-mist/70">
                read-only
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-pewter">{schedule.detail}</p>
          <p className="mt-0.5 font-mono text-[10px] text-steel">
            {kindLabel(schedule.kind)} · {triggerLabel(schedule)}
          </p>
        </div>
        <div className="text-[11.5px] text-graphite">
          <p>
            Next:{" "}
            <span className="font-medium text-ink">
              {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </p>
          <p className="mt-0.5 truncate">
            Last:{" "}
            {lastRun ? (
              <>
                {timeAgo(lastRun.startedAt)} · {String(lastRun.status).toLowerCase()}
                {lastRun.error ? ` · ${lastRun.error.slice(0, 80)}` : summarizeJson(lastRun.result, 80) ? ` · ${summarizeJson(lastRun.result, 80)}` : ""}
              </>
            ) : (
              "never run"
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 md:justify-end">
          <StatusPill status={tone.status} label={tone.label} />
          <button
            type="button"
            onClick={runNow}
            disabled={busy != null || schedule.status === "CANCELLED"}
            title="Run now"
            className="grid h-7 w-7 place-items-center rounded-lg border border-mist/80 text-ink transition-colors hover:bg-fog disabled:opacity-40"
          >
            {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          {canFlip ? (
            <button
              type="button"
              onClick={flip}
              disabled={busy != null}
              title={schedule.status === "PAUSED" ? "Resume" : "Pause"}
              className="grid h-7 w-7 place-items-center rounded-lg border border-mist/80 text-ink transition-colors hover:bg-fog disabled:opacity-40"
            >
              {busy === "flip" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggle}
            title="Run history"
            className="grid h-7 w-7 place-items-center rounded-lg text-steel transition-colors hover:bg-fog"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>
      {open ? (
        <div className="space-y-3 border-t border-mist/40 bg-fog/40 px-4 py-3">
          <ScheduleDetails schedule={schedule} />
          <div>
            <p className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-steel">Run history</p>
            <RunHistory scheduleId={schedule.id} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

function SchedulesPage() {
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const { data, isLoading, isError, error } = useQuery(schedulesQuery);
  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Schedules</h1>
          <p className="mt-1 text-[12.5px] text-pewter">
            The scheduler is the only business timer — payroll prep, invoice reminders, notifications, agent tasks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper"
        >
          <Plus className="h-3.5 w-3.5" /> New schedule
        </button>
      </header>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load schedules: {error?.message ?? "unknown error"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">No schedules yet</p>
          <p className="mt-1 text-[12px] text-pewter">New workspaces get payroll and reminder schedules automatically.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
          <ul className="divide-y divide-mist/50">
            {rows.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                open={openId === s.id}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              />
            ))}
          </ul>
        </div>
      )}

      <NewScheduleDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
