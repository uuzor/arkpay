import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users, CalendarClock, ShieldCheck, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import Money from "@/components/arkay/Money";
import StatusPill from "@/components/arkay/StatusPill";
import RiskChip from "@/components/arkay/RiskChip";
import ApprovalDrawer from "@/components/arkay/ApprovalDrawer";
import { actionTone, riskLabel, riskType, timeAgo } from "@/lib/actionShapes";
import { payrollDetailQuery, payrollRunsQuery, policyQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/payroll")({
  head: () => ({ meta: [{ title: "Payroll · Arkay" }] }),
  component: PayrollPage,
});

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function PayrollPage() {
  const queryClient = useQueryClient();
  const runs = useQuery(payrollRunsQuery);
  const policy = useQuery(policyQuery);
  const [period, setPeriod] = useState(null);
  const [preparePeriod, setPreparePeriod] = useState(currentPeriod());
  const [note, setNote] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [resending, setResending] = useState(false);
  const [drawerId, setDrawerId] = useState(null);
  const [lastPrepare, setLastPrepare] = useState(null);

  const runRows = runs.data ?? [];
  useEffect(() => {
    if (!period && runRows.length > 0) setPeriod(runRows[0].period);
  }, [period, runRows]);

  const detail = useQuery(payrollDetailQuery(period));
  const run = detail.data?.run ?? null;
  const members = detail.data?.members ?? [];
  const batchMaxTotal = Number(policy.data?.config?.batchMaxTotal ?? 0);
  const batchMaxItems = Number(policy.data?.config?.batchMaxItems ?? 0);
  const pct = run && batchMaxTotal > 0 ? Math.min(100, Math.round((Number(run.totalAmount) / batchMaxTotal) * 100)) : 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["payroll"] });
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: ["payouts"] });
  };

  const prepare = async () => {
    const p = preparePeriod.trim();
    if (!/^\d{4}-\d{2}$/.test(p)) {
      toast("Invalid period", { description: "Use YYYY-MM, e.g. 2026-11." });
      return;
    }
    setPreparing(true);
    setLastPrepare(null);
    try {
      const res = await apiJson("/payroll/prepare", { method: "POST", body: { period: p, note: note.trim() || undefined } });
      setLastPrepare(res);
      if (res?.created) {
        toast(`Payroll ${p} prepared`, {
          description: res.cardMessageId
            ? "Approval card sent to Telegram."
            : "No linked Telegram chat — run /pending in the bot to approve.",
        });
        setPeriod(p);
      } else {
        toast(`Payroll ${p} already exists`, { description: "Showing the existing run." });
        setPeriod(p);
      }
      refresh();
    } catch (e) {
      toast("Prepare failed", { description: e?.message ?? "Could not prepare payroll." });
      refresh();
    } finally {
      setPreparing(false);
    }
  };

  const resendCard = async () => {
    if (!period) return;
    setResending(true);
    try {
      const res = await apiJson(`/payroll/${encodeURIComponent(period)}/resend-card`, { method: "POST" });
      toast(
        res?.messageId ? "Approval card re-sent" : "No linked chat",
        { description: res?.messageId ? `Telegram message ${res.messageId}.` : "Link Telegram, then run /pending in the bot." },
      );
    } catch (e) {
      toast("Resend failed", { description: e?.message ?? "Could not re-send the card." });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Payroll</h1>
        <p className="mt-1 text-[12.5px] text-pewter">
          Say “pay my team.” Arkay assembles the batch from saved staff contacts, shows the total, and waits for one tap.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="rounded-xl border border-mist/70 bg-paper p-4">
            <h2 className="text-[13px] font-semibold text-ink">Prepare payroll</h2>
            <div className="mt-2.5 flex flex-wrap items-end gap-2">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Period</label>
                <input
                  value={preparePeriod}
                  onChange={(e) => setPreparePeriod(e.target.value)}
                  placeholder="2026-11"
                  className="mt-1 block h-9 w-32 rounded-lg border border-mist/80 px-2 font-mono text-[12.5px] outline-none focus:border-ink/40"
                />
              </div>
              <div className="min-w-[180px] flex-1">
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Note (optional)</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="November salaries"
                  className="mt-1 block h-9 w-full rounded-lg border border-mist/80 px-2 text-[12.5px] outline-none placeholder:text-steel focus:border-ink/40"
                />
              </div>
              <button
                type="button"
                onClick={prepare}
                disabled={preparing}
                className="rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
              >
                {preparing ? "Preparing…" : "Prepare"}
              </button>
            </div>
            {lastPrepare?.batch ? (
              <div className="mt-3 rounded-lg bg-fog/70 p-3 text-[12px] text-graphite">
                <p>
                  Batch <span className="font-mono text-[11px]">{lastPrepare.batch.batchId}</span> ·{" "}
                  {lastPrepare.batch.included?.length ?? 0} included ·{" "}
                  <Money amount={lastPrepare.batch.total} currency={lastPrepare.batch.currency} className="text-ink" />
                </p>
                {(lastPrepare.batch.excluded ?? []).length > 0 ? (
                  <ul className="mt-1.5 space-y-1">
                    {lastPrepare.batch.excluded.map((x, i) => (
                      <li key={i} className="text-[11.5px] text-amber-800">
                        Excluded {x.name} — {x.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          {runs.isLoading || detail.isLoading ? (
            <div className="h-72 animate-pulse rounded-xl bg-fog" />
          ) : runs.isError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
              Could not load payroll runs: {runs.error?.message ?? "unknown error"}
            </div>
          ) : !run ? (
            <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
              <p className="text-[13px] font-medium text-ink">No payroll prepared yet</p>
              <p className="mt-1 text-[12px] text-pewter">Prepare a period above, or wait for the monthly schedule.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-mist/70 bg-paper">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mist/60 px-4 py-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-steel">{run.period} · batch</p>
                    {(() => { const t = actionTone(run.status); return <StatusPill status={t.status} label={t.label} />; })()}
                  </div>
                  <Money amount={run.totalAmount} currency={run.currency} className="mt-1 block text-[28px] font-semibold text-ink" />
                  <p className="mt-0.5 text-[11.5px] text-pewter">
                    {members.length} recipient{members.length === 1 ? "" : "s"} · prepared {timeAgo(run.preparedAt)} by {run.preparedBy}
                    {run.note ? ` · ${run.note}` : ""}
                  </p>
                  {run.skippedReason ? (
                    <p className="mt-1 text-[11.5px] text-amber-800">Skipped: {run.skippedReason}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                    type="button"
                    onClick={resendCard}
                    disabled={resending}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-mist/80 px-3 py-2 text-[12px] font-medium text-ink hover:bg-fog disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" /> {resending ? "Sending…" : "Re-send card"}
                  </button>
                  <Link
                    to="/payouts"
                    search={{ batch: run.batchId }}
                    className="text-[12px] font-medium text-ink hover:underline"
                  >
                    Open in payouts →
                  </Link>
                </div>
              </div>

              <div className="divide-y divide-mist/50">
                {members.map((m) => {
                  const tone = actionTone(m.status);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setDrawerId(m.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fog/50"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fog text-[10.5px] font-semibold text-graphite">
                        {String(m.payeeName || "?").split(/\s+/).slice(0, 2).map((p) => p[0]).join("")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">{m.payeeName}</p>
                        <p className="truncate font-mono text-[10.5px] text-steel">{m.payeePaypal}</p>
                        {(m.riskFlags ?? []).length > 0 ? (
                          <span className="mt-1 flex flex-wrap gap-1">
                            {(m.riskFlags ?? []).map((f) => (
                              <RiskChip key={f} type={riskType(f)} label={riskLabel(f)} />
                            ))}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <Money amount={m.amount} currency={m.currency} className="block text-[13px] text-ink" />
                        <p className="text-[10px] text-pewter">
                          usual {m.contact?.usualAmount != null ? <Money amount={m.contact.usualAmount} currency={m.contact.currency} plain /> : "—"}
                        </p>
                      </div>
                      <StatusPill status={tone.status} label={tone.label} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-mist/70 bg-paper p-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-steel" strokeWidth={1.8} />
              <h2 className="text-[12.5px] font-semibold text-ink">Runs</h2>
            </div>
            {runRows.length === 0 ? (
              <p className="mt-2 text-[11.5px] text-pewter">No runs yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {runRows.map((r) => (
                  <li key={r.period}>
                    <button
                      type="button"
                      onClick={() => setPeriod(r.period)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors",
                        period === r.period ? "bg-fog font-medium" : "hover:bg-fog/60",
                      )}
                    >
                      <span className="font-mono text-[11.5px] text-ink">{r.period}</span>
                      <Money amount={r.totalAmount} currency={r.currency} className="text-[11.5px] text-graphite" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-mist/70 bg-paper p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-steel" strokeWidth={1.8} />
              <h2 className="text-[12.5px] font-semibold text-ink">Batch caps</h2>
            </div>
            <div className="mt-3 space-y-2.5">
              <div>
                <div className="flex justify-between text-[11px] text-graphite">
                  <span>Batch total</span>
                  <span className="font-mono text-[10.5px] text-steel">{pct}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fog">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-graphite">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-steel" /> Recipients
                </span>
                <span className="font-mono text-[10.5px] text-steel">
                  {members.length} / {batchMaxItems || "—"}
                </span>
              </div>
              <p className="text-[10.5px] leading-4 text-pewter">
                Every recipient and the total are shown before approval. Anything over cap needs a rule change first.
              </p>
            </div>
          </div>
        </div>
      </div>

      <ApprovalDrawer actionId={drawerId} open={Boolean(drawerId)} onOpenChange={(v) => !v && setDrawerId(null)} />
    </div>
  );
}
