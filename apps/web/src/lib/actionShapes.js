/** Shared adapters between the Nest API shapes and the dashboard cards. */

export const ACTION_STATUS_FILTERS = [
  { value: null, label: "All" },
  { value: "PENDING_APPROVAL", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "EXECUTED", label: "Executed" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "EXPIRED", label: "Expired" },
];

export const ACTION_TYPE_FILTERS = [
  { value: null, label: "All types" },
  { value: "INVOICE", label: "Invoices" },
  { value: "PAYOUT_SINGLE", label: "Single payouts" },
  { value: "PAYOUT_BATCH", label: "Batch members" },
];

export const EMAIL_STATUS_FILTERS = [
  { value: null, label: "All" },
  { value: "NEW", label: "New" },
  { value: "AWAITING_CONFIRM", label: "Awaiting confirm" },
  { value: "PROCESSED", label: "Processed" },
  { value: "NEEDS_REVIEW", label: "Needs review" },
  { value: "IGNORED", label: "Ignored" },
];

const STATUS_TONE = {
  PENDING_APPROVAL: { status: "pending", label: "Pending" },
  APPROVED: { status: "approved", label: "Approved" },
  EXECUTING: { status: "executing", label: "Executing" },
  EXECUTED: { status: "executed", label: "Executed" },
  FAILED: { status: "failed", label: "Failed" },
  BLOCKED: { status: "blocked", label: "Blocked" },
  IGNORED: { status: "ignored", label: "Ignored" },
  EXPIRED: { status: "expired", label: "Expired" },
  SUPERSEDED: { status: "neutral", label: "Superseded" },
};

export function actionTone(status) {
  return STATUS_TONE[status] ?? { status: "neutral", label: String(status ?? "—") };
}

const EMAIL_TONE = {
  NEW: { status: "pending", label: "New" },
  AWAITING_CONFIRM: { status: "pending", label: "Awaiting confirm" },
  PROCESSED: { status: "executed", label: "Processed" },
  NEEDS_REVIEW: { status: "pending", label: "Needs review" },
  IGNORED: { status: "ignored", label: "Ignored" },
};

export function emailTone(status) {
  return EMAIL_TONE[status] ?? { status: "neutral", label: String(status ?? "—") };
}

const RISK_TYPE = {
  NEW_PAYEE: "new_payee",
  PAYEE_CHANGED: "changed_payee",
  EMAIL_CHANGED: "changed_payee",
  DUPLICATE: "duplicate",
  DUPLICATE_SUSPECT: "duplicate",
  AMOUNT_ANOMALY: "amount_anomaly",
  INJECTION_SIGNAL: "injection",
  URGENCY: "urgency",
  URGENCY_PRESSURE: "urgency",
};

export function riskType(flag) {
  return RISK_TYPE[flag] ?? "note";
}

export function riskLabel(flag) {
  if (RISK_TYPE[flag]) return undefined;
  return String(flag).replace(/_/g, " ").toLowerCase();
}

const ACTION_TYPE_LABEL = {
  INVOICE: "invoice",
  PAYOUT_SINGLE: "payout",
  PAYOUT_BATCH: "batch payout",
};

export function actionTypeLabel(type) {
  return ACTION_TYPE_LABEL[type] ?? String(type ?? "").toLowerCase();
}

/**
 * Map a GET /approvals row (or a trace) onto the ApprovalCard shape.
 * List rows have no confidence/hash/idempotency — the drawer fills those in.
 */
export function adaptAction(row) {
  return {
    id: row.id,
    source: row.email ? "Gmail" : "Agent",
    receivedAt: row.createdAt ? timeAgo(row.createdAt) : "",
    receivedTitle: row.createdAt ? new Date(row.createdAt).toLocaleString() : "",
    status: actionTone(row.status).status,
    statusLabel: actionTone(row.status).label,
    rawStatus: row.status,
    rawType: row.type,
    type: actionTypeLabel(row.type),
    sender: {
      name: row.payeeName ?? row.contact?.name ?? "Unknown payee",
      email: row.payeePaypal ?? row.contact?.paypalEmail ?? "",
    },
    payeePaypal: row.payeePaypal ?? "",
    amount: row.amount ?? 0,
    currency: row.currency ?? "USD",
    purpose: row.purpose ?? "",
    risks: row.riskFlags ?? [],
    confidence: row.confidence == null ? null : Math.round(row.confidence * 100),
    hash: row.actionHash ?? null,
    idempotency: row.idempotencyKey ?? null,
    expiresAt: row.expiresAt ?? null,
    paypalRef: row.paypalRef ?? null,
    policyVerdict: row.policyVerdict ?? null,
    safetySummary: row.safetySummary ?? null,
    batchId: row.batchId ?? null,
    emailId: row.emailId ?? row.email?.id ?? null,
  };
}

export function timeAgo(value) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function expiryText(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Expired";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `Expires in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Expires in ${hours}h`;
  return `Expires in ${Math.floor(hours / 24)}d`;
}

/** Primary dashboard action for an approval row, or null when there is none. */
export function primaryFor(action) {
  if (action.rawStatus === "APPROVED") {
    if (action.rawType === "PAYOUT_BATCH") {
      return { kind: "batch", label: "Execute batch" };
    }
    return {
      kind: "execute",
      label: action.rawType === "INVOICE" ? "Send invoice" : `Pay ${action.currency} ${action.amount}`,
    };
  }
  if (action.rawStatus === "FAILED" && action.rawType === "INVOICE") {
    return { kind: "execute", label: "Retry invoice" };
  }
  return null;
}

const SCHEDULE_TONE = {
  ACTIVE: { status: "approved", label: "Active" },
  PAUSED: { status: "pending", label: "Paused" },
  DONE: { status: "executed", label: "Done" },
  CANCELLED: { status: "ignored", label: "Cancelled" },
};

export function scheduleTone(status) {
  return SCHEDULE_TONE[status] ?? { status: "neutral", label: String(status ?? "—") };
}

const RUN_TONE = {
  RUNNING: { status: "executing", label: "Running" },
  SUCCEEDED: { status: "executed", label: "Succeeded" },
  FAILED: { status: "failed", label: "Failed" },
  SKIPPED: { status: "ignored", label: "Skipped" },
};

export function runTone(status) {
  return RUN_TONE[status] ?? { status: "neutral", label: String(status ?? "—") };
}

const KIND_LABEL = {
  PAYROLL_PREPARE: "Payroll prep",
  INVOICE_REMINDERS: "Invoice reminders",
  NOTIFY: "Notify",
  AGENT_TASK: "Agent task",
  NOOP: "No-op",
};

export function kindLabel(kind) {
  return KIND_LABEL[kind] ?? String(kind ?? "").toLowerCase();
}

export function triggerLabel(schedule) {
  if (!schedule) return "—";
  if (schedule.trigger === "CRON") return `cron ${schedule.cron ?? ""} (${schedule.timezone ?? "UTC"})`.trim();
  if (schedule.trigger === "INTERVAL") return `every ${schedule.intervalMinutes ?? "?"} min`;
  if (schedule.trigger === "ONCE") {
    return schedule.runAt ? `once ${new Date(schedule.runAt).toLocaleString()}` : "once";
  }
  return String(schedule.trigger ?? "—");
}

export function summarizeJson(value, max = 160) {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
}

/** Human hint when the dashboard offers no primary button for this row. */
export function hintFor(action) {
  switch (action.rawStatus) {
    case "PENDING_APPROVAL":
      return "Tap Approve in Telegram — the dashboard can't approve, it can only execute after your tap.";
    case "APPROVED":
      return action.rawType === "PAYOUT_BATCH"
        ? "Batch members execute together — open details for the batch button."
        : null;
    case "FAILED":
      return action.rawType === "INVOICE"
        ? null
        : "Failed payouts aren't retried — create a new action instead.";
    case "BLOCKED":
      return action.safetySummary ?? "Blocked by the Payment Safety Engine.";
    case "EXECUTED":
      return action.paypalRef ? `Done · ${action.paypalRef}` : "Done.";
    case "EXPIRED":
      return "This approval expired before it was used.";
    case "IGNORED":
      return "Dismissed — nothing was executed.";
    case "SUPERSEDED":
      return "Edited — a newer action replaced this one.";
    default:
      return null;
  }
}
