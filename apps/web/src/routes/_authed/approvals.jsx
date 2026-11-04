import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import ApprovalCard from "@/components/arkay/ApprovalCard";
import ApprovalDrawer from "@/components/arkay/ApprovalDrawer";
import EditActionDialog from "@/components/arkay/EditActionDialog";
import {
  ACTION_STATUS_FILTERS,
  ACTION_TYPE_FILTERS,
  adaptAction,
  hintFor,
  primaryFor,
} from "@/lib/actionShapes";
import { approvalsInfinite } from "@/lib/queries";
import { removeDraft, useAgentDrafts } from "@/lib/agentDrafts";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/_authed/approvals")({
  head: () => ({ meta: [{ title: "Approvals · Arkay" }] }),
  component: ApprovalsPage,
});

function describeRefusal(res) {
  const detail = res?.detail ? ` — ${res.detail}` : "";
  switch (res?.reason) {
    case "not_found":
      return "Not found — it may belong to another workspace.";
    case "already_handled":
      return `Already handled (${res?.status ?? "see list"}). Refreshing.`;
    case "wrong_state":
      return `No longer pending${detail}. Refreshing.`;
    case "expired":
      return "Expired before it could run.";
    case "blocked":
      return detail || "Blocked by the Payment Safety Engine.";
    case "not_retryable":
      return detail || "Not retryable — create a new action.";
    case "demo_readonly":
      return detail || "Sandbox demo: payouts are read-only here.";
    case "paypal_failed":
      return `PayPal refused${detail}.`;
    case "cap_exceeded":
      return detail || "Over the batch cap.";
    case "unsupported_type":
      return detail || "Batch members execute together.";
    default:
      return `Refused (${res?.reason ?? "unknown"})${detail}.`;
  }
}

function ApprovalsPage() {
  const queryClient = useQueryClient();
  const drafts = useAgentDrafts();
  const [statusFilter, setStatusFilter] = useState("PENDING_APPROVAL");
  const [typeFilter, setTypeFilter] = useState(null);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const { workspace } = useAuth();
  const isDemo = workspace?.isDemo === true;

  const list = useInfiniteQuery(approvalsInfinite(statusFilter, typeFilter));
  const rows = useMemo(
    () => (list.data?.pages ?? []).flatMap((p) => p?.rows ?? []).map(adaptAction),
    [list.data],
  );
  const totalCount = list.data?.pages?.[0]?.totalCount;

  // Agent-chat drafts sit in front of the queue until F7 wires them to the API.
  const queue = useMemo(
    () => [...drafts.map((d) => ({ ...d, local: true })), ...rows],
    [drafts, rows],
  );
  const current = queue[Math.min(index, Math.max(queue.length - 1, 0))];

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
    queryClient.invalidateQueries({ queryKey: ["overview"] });
  }, [queryClient]);

  const removeLocal = useCallback((id) => {
    removeDraft(id);
    setIndex(0);
  }, []);

  // Demo-only: judges share one workspace (one Telegram pairing link), so
  // pending actions approve here instead of in Telegram. Same server-side
  // hash/version/audit machine; production stays tap-only.
  const approveDemo = useCallback(
    async (action) => {
      if (!action || action.local || busyId) return;
      setBusyId(action.id);
      try {
        const res = await apiJson(`/approvals/${encodeURIComponent(action.id)}/approve`, { method: "POST" });
        if (res?.ok) {
          toast("Approved", { description: "Now execute it to move to PayPal." });
        } else {
          toast("Not approved", { description: describeRefusal(res) });
        }
      } catch (e) {
        toast("Not approved", { description: e?.message ?? "Request failed." });
      } finally {
        setBusyId(null);
        refresh();
      }
    },
    [busyId, refresh],
  );

  const runPrimary = useCallback(
    async (action) => {
      if (!action || action.local || busyId) return;
      if (isDemo && action.rawStatus === "PENDING_APPROVAL") {
        return approveDemo(action);
      }
      const primary = primaryFor(action);
      if (!primary) {
        toast(hintFor(action) ?? "Nothing to do here.");
        return;
      }
      setBusyId(action.id);
      try {
        const path =
          primary.kind === "batch" && action.batchId
            ? `/approvals/batch/${encodeURIComponent(action.batchId)}/execute`
            : `/approvals/${encodeURIComponent(action.id)}/execute`;
        const res = await apiJson(path, { method: "POST" });
        if (res?.ok) {
          toast(primary.kind === "batch" ? "Batch executed" : "Executed", {
            description: res.paypalRef ? `PayPal ref ${res.paypalRef}.` : "Done.",
          });
        } else {
          toast("Not executed", { description: describeRefusal(res) });
        }
      } catch (e) {
        toast("Not executed", { description: e?.message ?? "Request failed." });
      } finally {
        setBusyId(null);
        refresh();
      }
    },
    [busyId, refresh, isDemo, approveDemo],
  );

  const ignoreAction = useCallback(
    async (action) => {
      if (!action || busyId) return;
      if (action.local) {
        removeLocal(action.id);
        toast(`${action.id} ignored`);
        return;
      }
      setBusyId(action.id);
      try {
        const res = await apiJson(`/approvals/${encodeURIComponent(action.id)}/ignore`, { method: "POST" });
        if (res?.ok) {
          toast(`${action.id} ignored`);
        } else {
          toast("Not ignored", { description: describeRefusal(res) });
        }
      } catch (e) {
        toast("Not ignored", { description: e?.message ?? "Request failed." });
      } finally {
        setBusyId(null);
        refresh();
      }
    },
    [busyId, refresh, removeLocal],
  );

  const approveLocal = useCallback(
    (request) => {
      if (!request) return;
      removeLocal(request.id);
      toast(`${request.id} approved in sandbox`, { description: "Hash verified · nothing was charged." });
    },
    [removeLocal],
  );

  const editAllowed = useCallback(
    (action) =>
      action &&
      !action.local &&
      action.rawType !== "PAYOUT_BATCH" &&
      (action.rawStatus === "PENDING_APPROVAL" || action.rawStatus === "APPROVED"),
    [],
  );
  const ignoreAllowed = useCallback(
    (action) => Boolean(action) && (action.local || action.rawStatus === "PENDING_APPROVAL"),
    [],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (editing || drawerId) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const item = queue[Math.min(index, Math.max(queue.length - 1, 0))];
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)));
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key.toLowerCase() === "a") {
        if (item?.local) approveLocal(item);
        else runPrimary(item);
      } else if (e.key.toLowerCase() === "e") {
        if (item && (item.local || editAllowed(item))) setEditing(item);
      } else if (e.key.toLowerCase() === "i") {
        if (item && ignoreAllowed(item)) ignoreAction(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, index, editing, drawerId, approveLocal, runPrimary, ignoreAction, editAllowed, ignoreAllowed]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Approvals</h1>
          <p className="mt-1 text-[12.5px] text-pewter">
            {typeof totalCount === "number" ? `${totalCount} action${totalCount === 1 ? "" : "s"}` : "The money queue"} ·{" "}
            {isDemo ? "approve and execute here — sandbox demo" : "approve in Telegram, execute here — one tap, one hash"}.
          </p>
        </div>
        <div className="hidden items-center gap-2 text-[10.5px] text-steel sm:flex">
          <kbd className="rounded border border-mist/80 bg-paper px-1.5 py-0.5 font-mono">J</kbd>
          <kbd className="rounded border border-mist/80 bg-paper px-1.5 py-0.5 font-mono">K</kbd>
          <span>move</span>
          <kbd className="rounded border border-mist/80 bg-paper px-1.5 py-0.5 font-mono">A</kbd>
          <span>act</span>
          <kbd className="rounded border border-mist/80 bg-paper px-1.5 py-0.5 font-mono">E</kbd>
          <span>edit</span>
          <kbd className="rounded border border-mist/80 bg-paper px-1.5 py-0.5 font-mono">I</kbd>
          <span>ignore</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {ACTION_STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => {
                setStatusFilter(f.value);
                setIndex(0);
              }}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                statusFilter === f.value ? "bg-ink text-paper" : "bg-paper text-graphite ring-1 ring-inset ring-mist/70 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={typeFilter ?? ""}
          onChange={(e) => {
            setTypeFilter(e.target.value || null);
            setIndex(0);
          }}
          className="ml-auto h-8 rounded-lg border border-mist/80 bg-paper px-2 text-[12px] text-ink outline-none focus:border-ink/40"
        >
          {ACTION_TYPE_FILTERS.map((f) => (
            <option key={f.label} value={f.value ?? ""}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load approvals: {list.error?.message ?? "unknown error"}
        </div>
      ) : queue.length === 0 ? (
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-12 text-center">
          <p className="text-[14px] font-semibold text-ink">
            {statusFilter === "PENDING_APPROVAL" ? "Queue clear" : "Nothing here"}
          </p>
          <p className="mt-1 text-[12px] text-pewter">
            {statusFilter === "PENDING_APPROVAL"
              ? "Every request has been handled. The agent keeps watching your inbox."
              : "No actions match this filter."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {queue.map((request, i) => {
              const primary = request.local
                ? null
                : isDemo && request.rawStatus === "PENDING_APPROVAL"
                  ? { label: "Approve" }
                  : primaryFor(request);
              return (
                <div key={request.id} onClick={() => setIndex(i)} role="presentation">
                  <ApprovalCard
                    request={request}
                    selected={i === index}
                    onApprove={request.local ? approveLocal : undefined}
                    onEdit={request.local || editAllowed(request) ? setEditing : undefined}
                    onIgnore={ignoreAllowed(request) ? ignoreAction : undefined}
                    onOpen={request.local ? undefined : (r) => setDrawerId(r.id)}
                    primary={
                      primary
                        ? { label: primary.label, onClick: runPrimary, disabled: busyId === request.id }
                        : null
                    }
                    hint={request.local ? null : hintFor(request)}
                    busy={busyId === request.id}
                  />
                </div>
              );
            })}
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

      <EditActionDialog
        request={editing}
        open={Boolean(editing)}
        onOpenChange={(v) => !v && setEditing(null)}
        onSaved={(newIdOrUpdated, oldId) => {
          if (editing?.local) {
            removeLocal(editing.id);
          } else {
            toast("Change saved — the old approval was voided", {
              description: `New action ${newIdOrUpdated}. Run /pending in Telegram for its card.`,
            });
            refresh();
          }
          setIndex(0);
          setEditing(null);
        }}
      />

      <ApprovalDrawer
        actionId={drawerId}
        open={Boolean(drawerId)}
        onOpenChange={(v) => !v && setDrawerId(null)}
        onPrimary={(action) => runPrimary(action)}
        onEdit={(action) => {
          setDrawerId(null);
          setEditing(action);
        }}
        onIgnore={(action) => {
          setDrawerId(null);
          ignoreAction(action);
        }}
        busy={Boolean(busyId)}
      />

      {current && queue.length ? (
        <p className="text-[11px] text-steel">
          Selected: <span className="font-mono text-graphite">{current.id}</span> · {current.sender.name} ·{" "}
          {current.purpose}
        </p>
      ) : null}
    </div>
  );
}
