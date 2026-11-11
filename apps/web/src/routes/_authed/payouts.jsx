import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiDownload } from "@/lib/api";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import PayoutSheet from "@/components/arkay/PayoutSheet";
import { ACTION_STATUS_FILTERS, actionTone, timeAgo } from "@/lib/actionShapes";
import { payoutsInfinite } from "@/lib/queries";

export const Route = createFileRoute("/_authed/payouts")({
  head: () => ({ meta: [{ title: "Payouts · Arkay" }] }),
  component: PayoutsPage,
});

// NOTE (Nov 2026 redesign): the Batches tab (team-payroll machinery) is frozen
// for the solo-earner story. Batch APIs, agent tools and execution keep working;
// this page shows singles only (client refunds, contractor payments).

function PayoutsPage() {
  const [statusFilter, setStatusFilter] = useState(null);
  const [payoutId, setPayoutId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      await apiDownload(`/payouts/export${qs}`, `arkpay-payouts-${day}.csv`);
      toast("Export downloaded", { description: "CSV of the filtered payouts." });
    } catch (e) {
      toast("Export failed", { description: e?.message ?? "Could not export payouts." });
    } finally {
      setExporting(false);
    }
  };

  const singles = useInfiniteQuery(payoutsInfinite(statusFilter));
  const singleRows = (singles.data?.pages ?? []).flatMap((p) => p?.rows ?? []);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Payouts</h1>
        <p className="mt-1 text-[12.5px] text-pewter">
          Money out: client refunds and contractor payments. Totals come from the API — never summed in the browser.
        </p>
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
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-mist/80 bg-paper px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-fog disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {singles.isLoading ? (
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
                      <button
                        type="button"
                        onClick={() => setPayoutId(row.id)}
                        className={cn(
                          "grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-fog/50 md:grid-cols-[minmax(0,1fr)_110px_130px_96px] md:items-center md:gap-3",
                          payoutId === row.id && "bg-fog/60",
                        )}
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
                      </button>
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
        )}

      <PayoutSheet payoutId={payoutId} open={Boolean(payoutId)} onOpenChange={(v) => !v && setPayoutId(null)} />
    </div>
  );
}
