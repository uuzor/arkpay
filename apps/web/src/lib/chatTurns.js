/** Turn model + metadata for the chat.md-grade agent bar. */

export const AGENT_GREETING_TEXT =
  "I'm the Arkay agent — same tools and safety gates as Telegram, in a panel. Ask about money in this workspace, or dictate a payment and I'll draft it for your approval.";

let seq = 0;
export function turnId(prefix = "turn") {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function newUserTurn(text, attachments = []) {
  return {
    id: turnId("user"),
    role: "user",
    text,
    attachments: attachments.map((f) => ({ name: f.name, size: f.size })),
    createdAt: new Date().toISOString(),
  };
}

export function newAgentTurn() {
  return {
    id: turnId("agent"),
    role: "agent",
    text: "",
    toolCalls: [],
    draft: null,
    document: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
}

export function finishTurn(turn, error = null) {
  return { ...turn, finishedAt: Date.now(), error };
}

/** "Worked for 35 seconds" / "Worked for 11 minutes", chat.md style. */
export function elapsedText(startedAt, finishedAt) {
  const ms = Math.max(0, (finishedAt ?? Date.now()) - startedAt);
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `Worked for ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Worked for ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `Worked for ${hours} hour${hours === 1 ? "" : "s"}`;
}

const TOOL_LABEL = {
  get_paypal_balance: "PayPal balance",
  get_account_summary: "Account summary",
  get_spend: "Spending",
  search_paypal_transactions: "Transaction search",
  list_pending: "Pending queue",
  search_emails: "Email search",
  lookup_contact: "Contact lookup",
  create_invoice_draft: "Invoice draft",
  request_payout: "Payout request",
  follow_up_invoice: "Invoice follow-up",
  generate_statement: "Statement",
  list_schedules: "Schedules",
  get_safety_policy: "Safety policy",
  list_blocked_actions: "Blocked actions",
  get_audit_trail: "Audit trail",
};

export function toolLabel(name) {
  if (TOOL_LABEL[name]) return TOOL_LABEL[name];
  if (String(name).startsWith("paypal_")) return "PayPal lookup";
  return String(name || "unknown").replace(/_/g, " ");
}

const SUMMARY_KEYS = [
  "payeeName", "payee", "name", "amount", "currency", "purpose", "query", "q",
  "actionId", "id", "email", "start", "end", "status", "filename", "text", "prompt",
];

function scalarPairs(value, max = 3) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const pairs = [];
  for (const key of SUMMARY_KEYS) {
    const v = value[key];
    if (v != null && (typeof v === "string" || typeof v === "number")) {
      pairs.push(`${key}: ${String(v).slice(0, 40)}`);
      if (pairs.length >= max) break;
    }
  }
  return pairs;
}

export function summarizeInput(input) {
  const pairs = scalarPairs(input);
  if (pairs.length) return pairs.join(" · ");
  if (input == null) return "";
  try {
    const s = JSON.stringify(input);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return "";
  }
}

export function summarizeOutput(output) {
  if (output == null) return "";
  if (typeof output === "string") return output.slice(0, 160);
  if (typeof output !== "object") return String(output).slice(0, 160);
  if (output.error) return `error: ${String(output.error).slice(0, 140)}`;
  if (output.found === false) return "not found";
  if (Array.isArray(output.rows)) return `${output.rows.length} row${output.rows.length === 1 ? "" : "s"}`;
  if (Array.isArray(output)) return `${output.length} item${output.length === 1 ? "" : "s"}`;
  const pairs = scalarPairs(output, 4);
  if (pairs.length) return pairs.join(" · ");
  try {
    const s = JSON.stringify(output);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return "";
  }
}

/**
 * Chat-thread identity. Linked workspaces share one Telegram+dashboard thread
 * (the server default); unlinked ones get a stable random id from localStorage
 * so chat still works before pairing.
 */
export function getChatUserId(linkedTelegramId) {
  if (linkedTelegramId !== undefined && linkedTelegramId !== null) return undefined;
  if (typeof window === "undefined") return undefined;
  const KEY = "arkpay:chat-user-id";
  let id = window.localStorage.getItem(KEY);
  if (!id || !/^\d+$/.test(id)) {
    id = String(100_000_000 + Math.floor(Math.random() * 899_999_999));
    window.localStorage.setItem(KEY, id);
  }
  return Number(id);
}

/** Dashboard context (open tab/row) appended to the agent's system prompt. */
export function contextForPath(pathname = "") {
  const key = pathname.split("/")[1] || "overview";
  const match = /^\/(requests|invoices|payouts)\/([^/]+)/.exec(pathname);
  if (match) return `The user is looking at ${match[1]} ${match[2]}.`;
  return `The user is looking at the ${key} tab.`;
}

// --- Demo-engine UI helpers (kept local; the demo answers retire with F7) ---

const CHIPS = {
  overview: ["What's my balance?", "Who hasn't paid?", "How did October look?"],
  approvals: ["What's in my queue?", "Why were any actions blocked?", "What are my caps?"],
  requests: ["What came in today?", "Anything duplicated?", "What's pending?"],
  invoices: ["Who hasn't paid?", "Any overdue invoices?", "What came in today?"],
  payouts: ["What's in flight?", "Any failed payouts?", "What are my caps?"],
  contacts: ["Which contacts changed?", "Who do I pay the most?", "How much did I pay Chidi?"],
  payroll: ["What's in this payroll run?", "Is the batch under the cap?"],
  schedules: ["What runs next?", "Any failed runs?"],
  rules: ["What are my caps?", "Which payee changes get blocked?", "Any blocked actions?"],
  audit: ["What was blocked today?", "What came in today?", "Who hasn't paid?"],
};

const DETAIL_CHIPS = ["Summarize the risk here", "Why is this blocked?", "What checks ran?"];

export function chipsForPath(pathname = "") {
  if (/^\/(requests|invoices|payouts)\/[^/]+/.test(pathname)) return DETAIL_CHIPS;
  const key = pathname.split("/")[1] || "overview";
  return CHIPS[key] ?? CHIPS.overview;
}

const LABELS = {
  overview: "on your overview",
  approvals: "on approvals",
  requests: "on requests",
  invoices: "on invoices",
  payouts: "on payouts",
  contacts: "on contacts",
  payroll: "on payroll",
  schedules: "on schedules",
  rules: "on rules",
  audit: "on audit",
  settings: "on settings",
};

export function contextLabel(pathname = "") {
  const match = /^\/(requests|invoices|payouts)\/([^/]+)/.exec(pathname);
  if (match) return `on ${match[2]}`;
  const key = pathname.split("/")[1] || "overview";
  return LABELS[key] ?? "on this tab";
}

/** Compose a demo answer ({text, bullets, source}) into markdown for the turn. */
export function demoAnswerToMarkdown(answer) {
  const parts = [answer.text];
  if (answer.bullets?.length) {
    parts.push("", ...answer.bullets.map((b) => `- ${b}`));
  }
  if (answer.source) parts.push("", `> ${answer.source}`);
  return parts.join("\n");
}
