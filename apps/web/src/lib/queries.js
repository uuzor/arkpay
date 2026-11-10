import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { apiJson } from "@/lib/api";

export const workspaceQuery = queryOptions({
  queryKey: ["workspace", "me"],
  queryFn: () => apiJson("/workspaces/me"),
  staleTime: 5_000,
});

export const policyQuery = queryOptions({
  queryKey: ["safety", "policy"],
  queryFn: () => apiJson("/safety/policy"),
  staleTime: 60_000,
});

export const schedulesQuery = queryOptions({
  queryKey: ["schedules"],
  queryFn: () => apiJson("/schedules"),
  staleTime: 15_000,
});

export function approvalsQuery(
  status = "PENDING_APPROVAL",
  limit = 5,
) {
  return queryOptions({
    queryKey: ["approvals", status, limit],
    queryFn: () =>
      apiJson(
        `/approvals?status=${encodeURIComponent(status)}&limit=${limit}`,
      ),
    staleTime: 10_000,
  });
}

export function emailsQuery(limit = 1) {
  return queryOptions({
    queryKey: ["emails", limit],
    queryFn: () => apiJson(`/ingest/emails?limit=${limit}`),
    staleTime: 10_000,
  });
}

export function emailsInfinite(status = null, q = "") {
  const params = new URLSearchParams({ limit: "20" });
  if (status) params.set("status", status);
  if (q.trim()) params.set("q", q.trim());
  const base = `/ingest/emails?${params.toString()}`;
  return infiniteQueryOptions({
    queryKey: ["emails", "list", status, q.trim()],
    queryFn: ({ pageParam }) =>
      apiJson(pageParam ? `${base}&cursor=${encodeURIComponent(pageParam)}` : base),
    initialPageParam: null,
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function emailDetailQuery(id) {
  return queryOptions({
    queryKey: ["emails", "detail", id],
    queryFn: () => apiJson(`/ingest/emails/${encodeURIComponent(id)}`),
    staleTime: 10_000,
  });
}

export const ingestStatusQuery = queryOptions({
  queryKey: ["ingest", "status"],
  queryFn: () => apiJson("/ingest/status"),
  staleTime: 15_000,
});

export const pipelineStatusQuery = queryOptions({
  queryKey: ["pipeline", "status"],
  queryFn: () => apiJson("/pipeline/status"),
  staleTime: 15_000,
});

export function approvalsInfinite(status = null, type = null) {
  const params = new URLSearchParams({ limit: "20" });
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  const base = `/approvals?${params.toString()}`;
  return infiniteQueryOptions({
    queryKey: ["approvals", "list", status, type],
    queryFn: ({ pageParam }) =>
      apiJson(pageParam ? `${base}&cursor=${encodeURIComponent(pageParam)}` : base),
    initialPageParam: null,
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function actionTraceQuery(id) {
  return queryOptions({
    queryKey: ["approvals", "trace", id],
    queryFn: () => apiJson(`/audit/actions/${encodeURIComponent(id)}`),
    staleTime: 10_000,
    enabled: Boolean(id),
  });
}

export function invoicesInfinite(status = null) {
  const params = new URLSearchParams({ limit: "20" });
  if (status) params.set("status", status);
  const base = `/invoices?${params.toString()}`;
  return infiniteQueryOptions({
    queryKey: ["invoices", "list", status],
    queryFn: ({ pageParam }) =>
      apiJson(pageParam ? `${base}&cursor=${encodeURIComponent(pageParam)}` : base),
    initialPageParam: null,
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function invoiceDetailQuery(id) {
  return queryOptions({
    queryKey: ["invoices", "detail", id],
    queryFn: () => apiJson(`/invoices/${encodeURIComponent(id)}`),
    staleTime: 10_000,
  });
}

export function payoutsInfinite(status = null) {
  const params = new URLSearchParams({ limit: "20" });
  if (status) params.set("status", status);
  const base = `/payouts?${params.toString()}`;
  return infiniteQueryOptions({
    queryKey: ["payouts", "list", status],
    queryFn: ({ pageParam }) =>
      apiJson(pageParam ? `${base}&cursor=${encodeURIComponent(pageParam)}` : base),
    initialPageParam: null,
    getNextPageParam: (last) => last?.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function payoutDetailQuery(id) {
  return queryOptions({
    queryKey: ["payouts", "detail", id],
    queryFn: () => apiJson(`/payouts/${encodeURIComponent(id)}`),
    staleTime: 10_000,
  });
}

export const payoutBatchesQuery = queryOptions({
  queryKey: ["payouts", "batches"],
  queryFn: () => apiJson("/payouts/batches"),
  staleTime: 15_000,
});

export function payoutBatchQuery(batchId) {
  return queryOptions({
    queryKey: ["payouts", "batch", batchId],
    queryFn: () => apiJson(`/payouts/batches/${encodeURIComponent(batchId)}`),
    staleTime: 10_000,
    enabled: Boolean(batchId),
  });
}

export function blockedQuery(limit = 20) {
  return queryOptions({
    queryKey: ["safety", "blocked", limit],
    queryFn: () => apiJson(`/safety/blocked?limit=${limit}`),
    staleTime: 15_000,
  });
}

export const policyVersionsQuery = queryOptions({
  queryKey: ["safety", "versions"],
  queryFn: () => apiJson("/safety/policies"),
  staleTime: 15_000,
});

export function scheduleDetailQuery(id) {
  return queryOptions({
    queryKey: ["schedules", "detail", id],
    queryFn: () => apiJson(`/schedules/${encodeURIComponent(id)}`),
    staleTime: 10_000,
    enabled: Boolean(id),
  });
}

export function scheduleRunsQuery(id) {
  return queryOptions({
    queryKey: ["schedules", "runs", id],
    queryFn: () => apiJson(`/schedules/${encodeURIComponent(id)}/runs?limit=10`),
    staleTime: 10_000,
    enabled: Boolean(id),
  });
}

export const payrollRunsQuery = queryOptions({
  queryKey: ["payroll", "runs"],
  queryFn: () => apiJson("/payroll"),
  staleTime: 15_000,
});

export function payrollDetailQuery(period) {
  return queryOptions({
    queryKey: ["payroll", "detail", period],
    queryFn: () => apiJson(`/payroll/${encodeURIComponent(period)}`),
    staleTime: 10_000,
    enabled: Boolean(period),
  });
}

export function auditRecentQuery(limit = 50) {
  return queryOptions({
    queryKey: ["audit", "recent", limit],
    queryFn: () => apiJson(`/audit/recent?limit=${limit}`),
    staleTime: 10_000,
  });
}

export function contactsQuery(kind = null) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  const qs = params.toString();
  return queryOptions({
    queryKey: ["contacts", "list", kind],
    queryFn: () => apiJson(`/contacts${qs ? `?${qs}` : ""}`),
    staleTime: 15_000,
  });
}

export function contactDetailQuery(id) {
  return queryOptions({
    queryKey: ["contacts", "detail", id],
    queryFn: () => apiJson(`/contacts/${encodeURIComponent(id)}`),
    staleTime: 10_000,
    enabled: Boolean(id),
  });
}

export function billingSubscriptionsQuery(status = null) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString();
  return queryOptions({
    queryKey: ["billing", "subscriptions", status],
    queryFn: () => apiJson(`/billing/subscriptions${qs ? `?${qs}` : ""}`),
    staleTime: 15_000,
  });
}

export function billingSubscriptionDetailQuery(id) {
  return queryOptions({
    queryKey: ["billing", "subscriptions", "detail", id],
    queryFn: () => apiJson(`/billing/subscriptions/${encodeURIComponent(id)}`),
    staleTime: 10_000,
    enabled: Boolean(id),
  });
}

export function billingDisputesQuery(state = null) {
  const params = new URLSearchParams();
  if (state) params.set("state", state);
  const qs = params.toString();
  return queryOptions({
    queryKey: ["billing", "disputes", state],
    queryFn: () => apiJson(`/billing/disputes${qs ? `?${qs}` : ""}`),
    staleTime: 15_000,
  });
}

export function billingDisputeDetailQuery(id) {
  return queryOptions({
    queryKey: ["billing", "disputes", "detail", id],
    queryFn: () => apiJson(`/billing/disputes/${encodeURIComponent(id)}`),
    staleTime: 10_000,
    enabled: Boolean(id),
  });
}

export const overviewQuery = queryOptions({
  queryKey: ["overview"],
  queryFn: async () => {
    const [pending, payouts, invoices, blocked, schedules, audit, workspace] =
      await Promise.all([
        apiJson("/approvals?status=PENDING_APPROVAL&limit=5"),
        apiJson("/payouts?limit=1"),
        apiJson("/invoices?limit=1"),
        apiJson("/safety/blocked?limit=50"),
        apiJson("/schedules"),
        apiJson("/audit/recent?limit=8"),
        apiJson("/workspaces/me"),
      ]);
    return {
      pendingCount: pending.totalCount ?? pending.rows?.length ?? 0,
      pendingRows: pending.rows ?? [],
      inFlightCount:
        (payouts.totalCount ?? 0) + (invoices.totalCount ?? 0),
      blockedCount: Array.isArray(blocked) ? blocked.length : 0,
      blockedRows: Array.isArray(blocked) ? blocked.slice(0, 3) : [],
      schedules: schedules ?? [],
      recent: audit ?? [],
      workspace,
    };
  },
  staleTime: 10_000,
});
