import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import Money from "@/components/arkay/Money";
import StatusPill from "@/components/arkay/StatusPill";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { apiJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  approvalsQuery,
  billingDisputesQuery,
  financeQuery,
  overviewQuery,
  workspaceQuery,
} from "@/lib/queries";

function firstName(name) {
  return (name || "there").split(/\s+/)[0];
}

function timeOf(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TILE_TONE = {
  default: "text-ink",
  green: "text-emerald-700",
  amber: "text-amber-800",
  red: "text-red-700",
};

function MoneyTile({ label, totals, hint, tone = "default", to, search }) {
  const entries = Object.entries(totals ?? {});
  const body =
    entries.length === 0 ? (
      <p className="mt-2 text-[25px] font-semibold leading-none tracking-[-0.03em] tabular text-steel">—</p>
    ) : (
      <div className="mt-2 space-y-0.5">
        {entries.slice(0, 2).map(([currency, value]) => (
          <Money
            key={currency}
            amount={value}
            currency={currency}
            className={cn("block text-[22px] font-semibold leading-tight text-ink", TILE_TONE[tone])}
          />
        ))}
        {entries.length > 2 ? (
          <p className="text-[11px] text-pewter">+{entries.length - 2} more currencies</p>
        ) : null}
      </div>
    );
  return (
    <div className="rounded-xl border border-mist/70 bg-paper p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">{label}</p>
      {body}
      {hint ? <p className="mt-2 text-[11.5px] leading-4 text-pewter">{hint}</p> : null}
      {to ? (
        <Link to={to} search={search} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-graphite hover:text-ink">
          Details <ArrowUpRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

export const Route = createFileRoute("/_authed/overview")({
  head: () => ({ meta: [{ title: "Overview · Arkay" }] }),
  component: OverviewPage,
});

function OverviewPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [remindingId, setRemindingId] = useState(null);
  const { data, isLoading, isError, error } = useQuery(overviewQuery);
  const { data: finance } = useQuery(financeQuery);
  const { data: workspace } = useQuery(workspaceQuery);
  const { data: pending } = useQuery(approvalsQuery("PENDING_APPROVAL", 5));
  const { data: disputes } = useQuery(billingDisputesQuery());

  const missing = [
    !workspace?.gmailConnected && "Gmail",
    !workspace?.paypalConnected && "PayPal",
    !workspace?.telegramLink?.telegramId && "Telegram",
  ].filter(Boolean);

  const remindNow = async (row) => {
    setRemindingId(row.id);
    try {
      const res = await apiJson(`/invoices/${encodeURIComponent(row.id)}/remind`, { method: "POST" });
      if (res?.alreadyPaid) {
        toast("Already paid", { description: `${row.payeeName} paid — no reminder sent.` });
      } else {
        toast("Reminder sent", { description: `${row.payeeName} · ${row.paypalRef ?? "invoice"}.` });
      }
      queryClient.invalidateQueries({ queryKey: ["overview", "finance"] });
    } catch (e) {
      toast("Reminder failed", { description: e?.message ?? "Could not send the reminder." });
    } finally {
      setRemindingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse rounded-xl bg-fog" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl bg-fog" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
        Could not load your workspace: {error?.message ?? "unknown error"}
      </div>
    );
  }

  const rows = data?.recent ?? [];
  const pendingRows = pending?.rows ?? data?.pendingRows ?? [];
  const openDisputes = (disputes?.rows ?? []).filter(
    (d) => d.state !== "RESOLVED" && d.status !== "RESOLVED",
  ).length;
  const overdue = finance?.overdue ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        {missing.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">
              Finish setup to unlock the full loop: {missing.join(", ")}.
            </p>
            <Button asChild size="sm" variant="outline" className="h-8 border-amber-300 bg-white text-amber-900">
              <Link to="/onboarding">Finish setup</Link>
            </Button>
          </div>
        ) : null}

        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.03em] text-ink">
              Good morning, {firstName(user?.name)}
            </h1>
            <p className="mt-1 text-[12.5px] text-pewter">
              {workspace?.name ?? "Your workspace"} · {data?.pendingCount ?? 0} action(s) need your tap
              {openDisputes > 0 ? ` · ${openDisputes} open dispute${openDisputes === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <Link
            to="/inbox"
            search={{ tab: "approvals" }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper"
          >
            Review approvals <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MoneyTile
            label="Received"
            totals={finance?.received}
            hint={finance?.receivedCount ? `${finance.receivedCount} paid invoice${finance.receivedCount === 1 ? "" : "s"}` : "no paid invoices yet"}
            tone="green"
            to="/money"
            search={{ tab: "invoices" }}
          />
          <MoneyTile
            label="Paid out"
            totals={finance?.paidOut}
            hint={finance?.paidOutCount ? `${finance.paidOutCount} payout${finance.paidOutCount === 1 ? "" : "s"} sent` : "no payouts sent"}
            to="/payouts"
          />
          <MoneyTile
            label="Outstanding"
            totals={finance?.outstanding}
            hint={finance?.outstandingCount ? `${finance.outstandingCount} unpaid invoice${finance.outstandingCount === 1 ? "" : "s"}` : "nothing owed to you"}
            to="/money"
            search={{ tab: "invoices" }}
          />
          <MoneyTile
            label="Overdue"
            totals={finance?.overdueTotal}
            hint={finance?.overdueCount ? `${finance.overdueCount} need chasing` : "nothing overdue"}
            tone={finance?.overdueCount ? "amber" : "default"}
          />
        </div>

        <div className="rounded-xl border border-mist/70 bg-paper">
          <div className="flex items-center justify-between border-b border-mist/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <BellRing className="h-3.5 w-3.5 text-steel" />
              <h2 className="text-[13px] font-semibold text-ink">Needs chasing</h2>
            </div>
            <Link to="/money" search={{ tab: "invoices" }} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-graphite hover:text-ink">
              All invoices <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {overdue.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-pewter">
              Nobody owes you money right now.
            </div>
          ) : (
            <ul className="divide-y divide-mist/50">
              {overdue.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">{row.payeeName}</p>
                    <p className="text-[11px] text-pewter">
                      {row.daysOverdue}d overdue
                      {row.reminders > 0 ? ` · reminded ${row.reminders}×` : " · never reminded"}
                    </p>
                  </div>
                  <Money amount={row.amount} currency={row.currency} className="shrink-0 text-[12.5px] text-ink" />
                  <button
                    type="button"
                    onClick={() => remindNow(row)}
                    disabled={remindingId === row.id}
                    className="shrink-0 rounded-lg border border-mist/80 bg-paper px-2.5 py-1.5 text-[11.5px] font-medium text-ink transition-colors hover:bg-fog disabled:opacity-50"
                  >
                    {remindingId === row.id ? "Sending…" : "Remind"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-mist/70 bg-paper">
          <div className="flex items-center justify-between border-b border-mist/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold text-ink">Agent activity</h2>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-fog px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-graphite">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> live
              </span>
            </div>
            <Link to="/audit" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-graphite hover:text-ink">
              Full ledger <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-pewter">
              No activity yet. A new request or a schedule run will appear here.
            </div>
          ) : (
            <ul className="divide-y divide-mist/50">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    to="/audit"
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fog/50"
                  >
                    <span className="w-11 shrink-0 font-mono text-[10.5px] text-steel">
                      {timeOf(row.createdAt)}
                    </span>
                    <span className="w-[78px] shrink-0 rounded-md bg-fog px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-[0.06em] text-graphite">
                      {String(row.type).toLowerCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                      {row.payeeName} · {row.purpose}
                    </span>
                    <Money amount={row.amount} currency={row.currency} className="hidden shrink-0 text-[12.5px] text-graphite sm:block" />
                    <StatusPill status={String(row.status).toLowerCase()} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-mist/70 bg-paper">
          <div className="flex items-center justify-between border-b border-mist/60 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Needs you</h2>
            <span className="rounded-md bg-ink px-1.5 py-px text-[10px] font-semibold text-paper tabular">
              {data?.pendingCount ?? 0}
            </span>
          </div>
          {pendingRows.length === 0 ? (
            <p className="px-4 py-6 text-center text-[11.5px] text-pewter">Nothing is waiting on you.</p>
          ) : (
            <div className="space-y-2 p-3">
              {pendingRows.slice(0, 4).map((row) => (
                <Link
                  key={row.id}
                  to="/inbox"
                  search={{ tab: "approvals" }}
                  className="block rounded-lg border border-mist/60 p-2.5 transition-colors hover:border-mist"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[12px] font-medium text-ink">{row.payeeName}</p>
                    <Money amount={row.amount} currency={row.currency} className="shrink-0 text-[12px] text-ink" />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="truncate text-[10.5px] text-pewter">{row.purpose}</p>
                    <StatusPill status={String(row.status).toLowerCase()} />
                  </div>
                </Link>
              ))}
              <Link
                to="/inbox"
                search={{ tab: "approvals" }}
                className="flex items-center justify-between rounded-lg bg-fog px-2.5 py-2 text-[11.5px] font-medium text-ink"
              >
                Open approval queue <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>

        {data?.blockedRows?.length ? (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-red-600" />
              <h2 className="text-[13px] font-semibold text-red-900">Blocked by policy</h2>
            </div>
            <ul className="mt-2 space-y-2">
              {data.blockedRows.map((row) => (
                <li key={row.id} className="text-[11.5px] text-red-900">
                  <span className="font-medium">{row.payeeName}</span> · {row.riskFlags?.join(", ")}
                </li>
              ))}
            </ul>
            <Link to="/audit" className="mt-2 inline-block text-[11.5px] font-medium text-red-800 hover:underline">
              Review blocked actions →
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
