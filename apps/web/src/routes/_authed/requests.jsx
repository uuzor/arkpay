import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import RequestTable from "@/components/arkay/RequestTable";
import { EMAIL_STATUS_FILTERS, timeAgo } from "@/lib/actionShapes";
import { emailsInfinite, ingestStatusQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/requests")({
  head: () => ({ meta: [{ title: "Requests · Arkay" }] }),
  component: RequestsPage,
});

function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function describeSync(res) {
  if (!res || typeof res !== "object") return "Mailbox synced.";
  const parts = [];
  if (typeof res.inserted === "number") parts.push(`${res.inserted} new`);
  if (typeof res.updated === "number") parts.push(`${res.updated} updated`);
  if (typeof res.skipped === "number") parts.push(`${res.skipped} skipped`);
  return parts.length ? `${parts.join(" · ")} email(s).` : "Mailbox synced.";
}

function RequestsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query);
  const [syncing, setSyncing] = useState(false);
  const [piping, setPiping] = useState(false);

  const list = useInfiniteQuery(emailsInfinite(filter, debouncedQuery));
  const status = useQuery(ingestStatusQuery);

  const emails = (list.data?.pages ?? []).flatMap((p) => p?.rows ?? []);
  const totalCount = list.data?.pages?.[0]?.totalCount;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["emails"] });
    queryClient.invalidateQueries({ queryKey: ["ingest", "status"] });
    queryClient.invalidateQueries({ queryKey: ["pipeline", "status"] });
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await apiJson("/ingest/run", { method: "POST" });
      toast("Inbox synced", { description: describeSync(res) });
      refresh();
    } catch (e) {
      toast("Sync failed", { description: e?.message ?? "Could not sync the inbox." });
    } finally {
      setSyncing(false);
    }
  };

  const runPipeline = async () => {
    setPiping(true);
    try {
      const res = await apiJson("/pipeline/run", { method: "POST", body: { limit: 5 } });
      if (res?.skipped) {
        toast("Pipeline already running", { description: "A run is in progress — try again in a moment." });
      } else {
        toast("Pipeline run finished", {
          description: `${res?.processed ?? 0} processed · ${res?.carded ?? 0} carded · ${res?.blocked ?? 0} blocked · ${res?.ignored ?? 0} ignored · ${res?.needsReview ?? 0} need review.`,
        });
      }
      refresh();
    } catch (e) {
      toast("Pipeline run failed", { description: e?.message ?? "Could not run the pipeline." });
    } finally {
      setPiping(false);
    }
  };

  const ingest = status.data;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Requests</h1>
          <p className="mt-1 text-[12.5px] text-pewter">
            Every money email Arkay read, what it extracted, and what it decided to do.
            {typeof totalCount === "number" ? ` · ${totalCount} email(s)` : ""}
          </p>
          {ingest ? (
            <p className="mt-1 font-mono text-[10.5px] text-steel">
              {ingest.mailbox ?? "no mailbox"} · cursor {ingest.checkpoint?.historyId ?? "—"} ·{" "}
              {ingest.newest ? `newest ${timeAgo(ingest.newest.receivedAt)}` : "empty inbox"}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runPipeline}
            disabled={piping}
            className="inline-flex items-center gap-1.5 rounded-xl border border-mist/80 bg-paper px-3 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-fog disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> {piping ? "Running…" : "Run pipeline"}
          </button>
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-[12.5px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} /> {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {EMAIL_STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                filter === f.value ? "bg-ink text-paper" : "bg-paper text-graphite ring-1 ring-inset ring-mist/70 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sender, subject or body"
          className="ml-auto h-8 w-full rounded-lg border border-mist/80 bg-paper px-2.5 text-[12px] text-ink outline-none placeholder:text-steel focus:border-ink/40 sm:w-[240px]"
        />
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load emails: {list.error?.message ?? "unknown error"}
        </div>
      ) : (
        <>
          <RequestTable emails={emails} />
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
