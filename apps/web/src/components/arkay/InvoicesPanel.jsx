import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import { ACTION_STATUS_FILTERS, actionTone, timeAgo } from "@/lib/actionShapes";
import { invoicesInfinite } from "@/lib/queries";

export default function InvoicesPanel({ onSelectInvoice, selectedInvoiceId }) {
  const [statusFilter, setStatusFilter] = useState(null);
  const list = useInfiniteQuery(invoicesInfinite(statusFilter));
  const rows = (list.data?.pages ?? []).flatMap((p) => p?.rows ?? []);
  const totalCount = list.data?.pages?.[0]?.totalCount;

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-pewter">
        PayPal invoices Arkay prepared and sent.
        {typeof totalCount === "number" ? ` · ${totalCount} total` : ""}
      </p>

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

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load invoices: {list.error?.message ?? "unknown error"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">No invoices here</p>
          <p className="mt-1 text-[12px] text-pewter">Approved invoice actions appear here once they exist.</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
            <div className="hidden grid-cols-[minmax(0,1fr)_110px_120px_130px_96px] gap-3 border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel md:grid">
              <span>Bill to</span>
              <span className="text-right">Amount</span>
              <span>Due</span>
              <span>PayPal</span>
              <span className="text-right">Status</span>
            </div>
            <ul className="divide-y divide-mist/50">
              {rows.map((row) => {
                const tone = actionTone(row.status);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => onSelectInvoice?.(row.id)}
                      className={cn(
                        "grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-fog/50 md:grid-cols-[minmax(0,1fr)_110px_120px_130px_96px] md:items-center md:gap-3",
                        selectedInvoiceId === row.id && "bg-fog/60",
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
                      <div>
                        <span className="text-[11.5px] text-steel">
                          {row.dueDate ? new Date(row.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                        </span>
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
          {list.hasNextPage ? (
            <button
              type="button"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className="w-full rounded-xl border border-mist/80 bg-paper px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-fog disabled:opacity-50"
            >
              {list.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
