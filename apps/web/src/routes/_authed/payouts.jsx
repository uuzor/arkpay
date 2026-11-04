import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import ApprovalDrawer from "@/components/arkay/ApprovalDrawer";
import { ACTION_STATUS_FILTERS, actionTone, timeAgo } from "@/lib/actionShapes";
import { payoutBatchQuery, payoutBatchesQuery, payoutsInfinite } from "@/lib/queries";

export const Route = createFileRoute("/_authed/payouts")({
  validateSearch: (search) => ({
    batch: typeof search?.batch === "string" ? search.batch : undefined,
  }),
  head: () => ({ meta: [{ title: "Payouts · Arkay" }] }),
  component: PayoutsPage,
});

function StatusRollup({ statuses }) {
  const entries = Object.entries(statuses ?? {});
  if (!entries.length) return <span className="text-[11px] text-steel">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([status, count]) => {
        const tone = actionTone(status);
        return (
          <span
            key={status}
            className="rounded-md bg-fog px-1.5 py-0.5 font-mono text-[10px] text-graphite"
            title={tone.label}
          >
            {tone.label} × {count}
          </span>
        );
      })}
    </span>
  );
}

function BatchRow({ batch, open, onToggle, onMember }) {
  const queryClient = useQueryClient();
  const [executing, setExecuting] = useState(false);
  const detail = useQuery({ ...payoutBatchQuery(batch.batchId), enabled: open });
  const members = detail.data?.members ?? [];
  const allApproved =
    members.length > 0 && members.every((m) => m.status === "APPROVED");

  const executeBatch = async () => {
    setExecuting(true);
    try {
      const res = await apiJson(`/approvals/batch/${encodeURIComponent(batch.batchId)}/execute`, { method: "POST" });
      if (res?.ok) {
        toast("Batch executed", { description: res.paypalRef ? `PayPal ref ${res.paypalRef}.` : "Done." });
      } else {
        toast("Not executed", { description: `${res?.reason ?? "refused"}${res?.detail ? ` — ${res.detail}` : ""}` });
      }
      queryClient.invalidateQueries({ queryKey: ["payouts"] });
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    } catch (e) {
      toast("Not executed", { description: e?.message ?? "Request failed." });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-fog/50 md:grid-cols-[minmax(0,1fr)_110px_150px_120px_20px] md:items-center md:gap-3"
      >
        <div className="min-w-0">
          <p className="truncate font-mono text-[11.5px] text-ink">{batch.batchId}</p>
          <p className="mt-0.5 text-[11.5px] text-pewter">
            {batch.count} recipient{batch.count === 1 ? "" : "s"} · {timeAgo(batch.createdAt)}
          </p>
        </div>
        <div className="md:text-right">
          <Money amount={batch.total} currency={batch.currency} className="text-[13px] text-ink" />
        </div>
        <div>
          <StatusRollup statuses={batch.statuses} />
        </div>
        <div className="min-w-0">
          <span className="block truncate font-mono text-[10.5px] text-steel" title={batch.paypalRef ?? ""}>
            {batch.paypalRef ?? "—"}
          </span>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-steel transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="border-t border-mist/40 bg-fog/40 px-4 py-3">
          {detail.isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-fog" />
          ) : detail.isError ? (
            <p className="text-[12px] text-red-700">Could not load batch members: {detail.error?.message}</p>
          ) : (
            <>
              <ul className="divide-y divide-mist/50 rounded-lg border border-mist/60 bg-paper">
                {members.map((m) => {
                  const tone = actionTone(m.status);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => onMember?.(m.id)}
                        className="flex w-full flex-wrap items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-fog/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-ink">{m.payeeName}</span>
                          <span className="block truncate font-mono text-[10px] text-steel">{m.id}</span>
                        </span>
                        <Money amount={m.amount} currency={m.currency} className="text-[12.5px] text-ink" />
                        <StatusPill status={tone.status} label={tone.label} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {allApproved ? (
                <button
                  type="button"
                  onClick={executeBatch}
                  disabled={executing}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
                >
                  {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {executing ? "Executing…" : `Execute batch of ${members.length}`}
                </button>
              ) : (
                <p className="mt-3 text-[11.5px] text-pewter">
                  Batches execute atomically once every member is approved in Telegram.
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function PayoutsPage() {
  const { batch: deepBatch } = Route.useSearch();
  const [tab, setTab] = useState("singles");
  const [statusFilter, setStatusFilter] = useState(null);
  const [openBatch, setOpenBatch] = useState(null);
  const [drawerId, setDrawerId] = useState(null);

  const singles = useInfiniteQuery(payoutsInfinite(statusFilter));
  const batches = useQuery(payoutBatchesQuery);
  const singleRows = (singles.data?.pages ?? []).flatMap((p) => p?.rows ?? []);
  const batchRows = batches.data?.batches ?? [];

  useEffect(() => {
    if (deepBatch) {
      setTab("batches");
      setOpenBatch(deepBatch);
    }
  }, [deepBatch]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Payouts</h1>
        <p className="mt-1 text-[12.5px] text-pewter">
          Money out: single payouts plus batch roll-ups. Totals come from the API — never summed in the browser.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-fog p-1">
          {[
            { value: "singles", label: "Singles" },
            { value: "batches", label: `Batches${batchRows.length ? ` (${batchRows.length})` : ""}` },
          ].map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                tab === t.value ? "bg-paper text-ink shadow-sm" : "text-graphite hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "singles" ? (
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
        ) : null}
      </div>

      {tab === "singles" ? (
        singles.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-fog" />
            ))}
          </div>
        ) : singles.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
            Could not load payouts: {singles.error?.message ?? "unknown error"}
          </div>
        ) : singleRows.length === 0 ? (
          <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
            <p className="text-[13px] font-medium text-ink">No single payouts here</p>
            <p className="mt-1 text-[12px] text-pewter">Approved single-payout actions appear here once they exist.</p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
              <div className="hidden grid-cols-[minmax(0,1fr)_110px_130px_96px] gap-3 border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel md:grid">
                <span>Payee</span>
                <span className="text-right">Amount</span>
                <span>PayPal</span>
                <span className="text-right">Status</span>
              </div>
              <ul className="divide-y divide-mist/50">
                {singleRows.map((row) => {
                  const tone = actionTone(row.status);
                  return (
                    <li key={row.id}>
                      <Link
                        to="/payouts/$payoutId"
                        params={{ payoutId: row.id }}
                        className="grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-fog/50 md:grid-cols-[minmax(0,1fr)_110px_130px_96px] md:items-center md:gap-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-ink">{row.payeeName}</p>
                          <p className="truncate text-[11.5px] text-pewter">{row.purpose}</p>
                          <p className="truncate font-mono text-[10px] text-steel">{row.payeePaypal}</p>
                        </div>
                        <div className="md:text-right">
                          <Money amount={row.amount} currency={row.currency} className="text-[13px] text-ink" />
                        </div>
                        <div className="min-w-0">
                          <span className="block truncate font-mono text-[10.5px] text-steel" title={row.paypalRef ?? ""}>
                            {row.paypalRef ?? "not sent yet"}
                          </span>
                          <span className="text-[10.5px] text-pewter">{timeAgo(row.createdAt)}</span>
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
            {singles.hasNextPage ? (
              <button
                type="button"
                onClick={() => singles.fetchNextPage()}
                disabled={singles.isFetchingNextPage}
                className="w-full rounded-xl border border-mist/80 bg-paper px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-fog disabled:opacity-50"
              >
                {singles.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </>
        )
      ) : batches.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : batches.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load batches: {batches.error?.message ?? "unknown error"}
        </div>
      ) : batchRows.length === 0 ? (
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">No batches yet</p>
          <p className="mt-1 text-[12px] text-pewter">Payroll runs and “pay my team” batches land here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_150px_120px_20px] gap-3 border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel md:grid">
            <span>Batch</span>
            <span className="text-right">Total</span>
            <span>Members</span>
            <span>PayPal</span>
            <span />
          </div>
          <ul className="divide-y divide-mist/50">
            {batchRows.map((b) => (
              <BatchRow
                key={b.batchId}
                batch={b}
                open={openBatch === b.batchId}
                onToggle={() => setOpenBatch(openBatch === b.batchId ? null : b.batchId)}
                onMember={setDrawerId}
              />
            ))}
          </ul>
        </div>
      )}

      <ApprovalDrawer actionId={drawerId} open={Boolean(drawerId)} onOpenChange={(v) => !v && setDrawerId(null)} />
    </div>
  );
}
