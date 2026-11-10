/**
 * Pure agent-reply helpers: follow-up parsing, tool-result narration, and
 * schedule-input validation. No Nest imports — unit-tested via
 * `pnpm --filter @arkpay/api test:agent`.
 */

export interface DraftFollowUp {
  payeeName?: string;
  purpose?: string;
}

const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const AMOUNT_LIKE =
  /[$€£₦]\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*[$€£₦]|\b(?:usd|eur|gbp|ngn)\b\s*[\d,]+/i;
const NEW_INTENT =
  /^\s*(create|send|pay|make|draft|follow|what|show|list|give|check|how|remind|schedule)\b/i;

/** Second user message on the empty-reply retry: different tokens break a deterministic stall. */
export const RETRY_NUDGE =
  'Please respond now in plain text, or call the appropriate tool if one fits.';

const INVOICE_NEW_RE =
  /\b(create|send|make|draft|raise|issue|new)\b[^\n]{0,80}?\binvoice\b/i;
const INVOICE_IMPERATIVE_RE = /^\s*invoice\b/i;
const BILL_RE = /\bbill\b/i;
// Anything that reads, revisits, undoes, or asks ABOUT an invoice — never a
// new draft. The meta-question exclusions matter most for moneyless intents,
// where there are no money hints to disambiguate ("Make me an invoice
// template" is not a draft request).
const INVOICE_EXCLUDE_RE =
  /follow.?up|resend|re-send|forward|cancel|void|delete|refund|status|audit|block|dispute|remind|paid|overdue|history|list|show|template|sample|example|format|tutorial|explain|how to|how do|what is|what's/i;
const CURRENCY_SYMBOL: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₦': 'NGN',
};

/**
 * Extracts invoice/payout fields from a short follow-up message answering a
 * "what's missing" question ("Its for my shoe, name is precious Ezealor").
 * Returns null when the message looks like a new request or carries nothing
 * usable, so the caller falls through to the model.
 */
export function parseDraftFollowUp(message: string): DraftFollowUp | null {
  const text = message.trim();
  if (!text || text.length > 200) return null;
  if (EMAIL_LIKE.test(text)) return null; // bare-email path owns these
  if (AMOUNT_LIKE.test(text)) return null; // amount changes go to the model
  if (NEW_INTENT.test(text)) return null;
  const payeeName = text
    .match(/\b(?:payee\s+)?name\s+is\s+([^,.;!?]+)/i)?.[1]
    ?.trim();
  const purpose = text
    .match(/\b(?:it'?s\s+for|for)\s+(.+)/i)?.[1]
    ?.replace(/,?\s*(?:payee\s+)?name\s+is\s+.*$/i, '')
    .replace(/[.;!?]+$/, '')
    .trim();
  if (!payeeName && !purpose) return null;
  return {
    ...(payeeName ? { payeeName } : {}),
    ...(purpose ? { purpose } : {}),
  };
}

export interface ActionToolOutput {
  ok?: boolean;
  blocked?: boolean;
  message?: unknown;
  payeeName?: unknown;
  amount?: unknown;
  currency?: unknown;
  purpose?: unknown;
}

/**
 * User-facing narration for a state-changing tool result. Used when the
 * model emits no text after acting, so a completed draft never degrades to
 * the "I'm here" fallback. Returns null when there is nothing to narrate.
 */
export function describeActionResult(
  toolName: string,
  output: unknown,
): string | null {
  if (!output || typeof output !== 'object') return null;
  const out = output as ActionToolOutput;
  if (
    toolName !== 'create_invoice_draft' &&
    toolName !== 'request_payout' &&
    toolName !== 'manage_subscription' &&
    toolName !== 'respond_dispute'
  ) {
    return typeof out.message === 'string' && out.message ? out.message : null;
  }
  if (!out.ok) {
    return typeof out.message === 'string' && out.message
      ? out.message
      : 'I need a few more details.';
  }
  const facts = `${out.payeeName}: ${out.currency} ${out.amount} for ${out.purpose}`;
  if (toolName === 'create_invoice_draft') {
    return `🧾 Draft created for ${facts}. Approve the card to send it.`;
  }
  if (toolName === 'request_payout') {
    return `💸 Payout drafted for ${facts}. Nothing moves until you tap Pay.`;
  }
  // manage_subscription / respond_dispute already phrase their own outcome
  // (op-specific verb + exact-text promise); reuse it verbatim.
  return typeof out.message === 'string' && out.message ? out.message : null;
}

export type AgentScheduleKind =
  | 'NOTIFY'
  | 'AGENT_TASK'
  | 'INVOICE_REMINDERS'
  | 'PAYROLL_PREPARE';
export type AgentScheduleTrigger = 'ONCE' | 'INTERVAL' | 'CRON';

export interface AgentScheduleInput {
  title?: string;
  kind?: string;
  detail?: string;
  trigger?: string;
  runAt?: string;
  intervalMinutes?: number;
  cron?: string;
  timezone?: string;
}

export interface AgentScheduleValid {
  ok: true;
  input: {
    title: string;
    kind: AgentScheduleKind;
    detail: string;
    trigger: AgentScheduleTrigger;
    runAt?: string;
    intervalMinutes?: number;
    cron?: string;
    timezone: string;
  };
}

export interface AgentScheduleInvalid {
  ok: false;
  error: string;
}

const AGENT_SCHEDULE_KINDS: AgentScheduleKind[] = [
  'NOTIFY',
  'AGENT_TASK',
  'INVOICE_REMINDERS',
  'PAYROLL_PREPARE',
];
const AGENT_SCHEDULE_TRIGGERS: AgentScheduleTrigger[] = [
  'ONCE',
  'INTERVAL',
  'CRON',
];

/**
 * Validates agent schedule-creation input before it reaches
 * SchedulerService. Case-insensitive; defaults detail to the title except
 * for NOTIFY/AGENT_TASK, where the message/prompt is the whole point.
 */
export function buildScheduleCreate(
  input: AgentScheduleInput,
): AgentScheduleValid | AgentScheduleInvalid {
  const title = input.title?.trim();
  if (!title) return { ok: false, error: 'A schedule needs a short title.' };
  const kind = input.kind?.trim().toUpperCase();
  if (!kind || !AGENT_SCHEDULE_KINDS.includes(kind as AgentScheduleKind)) {
    return {
      ok: false,
      error: `kind must be one of ${AGENT_SCHEDULE_KINDS.join(', ')}.`,
    };
  }
  const trigger = input.trigger?.trim().toUpperCase();
  if (
    !trigger ||
    !AGENT_SCHEDULE_TRIGGERS.includes(trigger as AgentScheduleTrigger)
  ) {
    return {
      ok: false,
      error: `trigger must be one of ${AGENT_SCHEDULE_TRIGGERS.join(', ')}.`,
    };
  }
  if ((kind === 'NOTIFY' || kind === 'AGENT_TASK') && !input.detail?.trim()) {
    return {
      ok: false,
      error: `A ${kind} schedule needs detail: the message to send (NOTIFY) or the task prompt (AGENT_TASK).`,
    };
  }
  if (trigger === 'ONCE' && !input.runAt) {
    return { ok: false, error: 'ONCE schedules need runAt (ISO date-time).' };
  }
  if (
    trigger === 'INTERVAL' &&
    !(input.intervalMinutes && input.intervalMinutes > 0)
  ) {
    return {
      ok: false,
      error: 'INTERVAL schedules need intervalMinutes greater than 0.',
    };
  }
  if (trigger === 'CRON' && !input.cron?.trim()) {
    return {
      ok: false,
      error: 'CRON schedules need a 5-field cron expression.',
    };
  }
  return {
    ok: true,
    input: {
      title,
      kind: kind as AgentScheduleKind,
      detail: input.detail?.trim() || title,
      trigger: trigger as AgentScheduleTrigger,
      ...(input.runAt ? { runAt: input.runAt } : {}),
      ...(input.intervalMinutes ? { intervalMinutes: input.intervalMinutes } : {}),
      ...(input.cron?.trim() ? { cron: input.cron.trim() } : {}),
      timezone: input.timezone?.trim() || 'UTC',
    },
  };
}

export interface InvoiceFirstTurn {
  payeeEmail?: string;
  amount?: string;
  currency?: string;
  purpose?: string;
}

function cleanAmount(raw: string): string | undefined {
  const cleaned = raw.replace(/[$,\s]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? cleaned : undefined;
}

/** Email + amount + currency extraction shared by first-turn and follow-up parsing. */
function extractMoneyBits(text: string): {
  payeeEmail?: string;
  amount?: string;
  currency?: string;
} {
  const payeeEmail = text.match(EMAIL_LIKE)?.[0]?.toLowerCase();
  const amountMatch =
    text.match(/[$€£₦]\s*([\d,]+(?:\.\d{1,2})?)/) ??
    text.match(/([\d,]+(?:\.\d{1,2})?)\s*[$€£₦]/) ??
    text.match(/\b(?:usd|eur|gbp|ngn)\b\s*([\d,]+(?:\.\d{1,2})?)/i) ??
    text.match(/\bof\s+[$€£₦]?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const amount = amountMatch ? cleanAmount(amountMatch[1]) : undefined;
  let currency: string | undefined;
  const symbol = text.match(/[$€£₦]/)?.[0];
  if (symbol) currency = CURRENCY_SYMBOL[symbol];
  else {
    const code = text.match(/\b(usd|eur|gbp|ngn)\b/i)?.[1];
    if (code) currency = code.toUpperCase();
  }
  return {
    ...(payeeEmail ? { payeeEmail } : {}),
    ...(amount ? { amount } : {}),
    ...(currency ? { currency } : {}),
  };
}

/**
 * Purpose from the text after the LAST "for" — only when a payee anchor AND
 * an amount exist, so "invoice Acme" never mistakes the payee for the
 * purpose. Trailing name clauses ("…, name is Ada") are stripped.
 */
function extractPurposeBit(
  text: string,
  anchored: boolean,
  hasAmount: boolean,
): string | undefined {
  if (!anchored || !hasAmount) return undefined;
  const segments = text.split(/\bfor\s+/i);
  if (segments.length < 2) return undefined;
  const candidate = segments[segments.length - 1]
    .trim()
    .replace(/,?\s*(?:payee\s+)?name\s+is\s+.*$/i, '')
    .replace(/[.;!?]+$/, '');
  if (
    !candidate ||
    candidate.length > 120 ||
    /[@$€£₦]/.test(candidate) ||
    /\b(?:usd|eur|gbp|ngn)\b/i.test(candidate) ||
    /\d/.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

/**
 * Deterministic first-turn parse for NEW invoice requests ("Send invoice to
 * Ada (ada@x) for $450 for flyers"). Returns null when the message is not a
 * new-invoice intent, so the caller falls through to the model. Conservative
 * by design: mails that read, revisit, undo, or ask about an invoice never
 * match, and the payee name is left to the service merge (it owns the
 * contact rules). Moneyless intents ("create an invoice") return {} so the
 * caller asks the kickoff question instead of involving the model.
 * Mirrors the amount semantics of the service parser without importing it,
 * so this file stays dependency-free for the unit harness.
 */
export function parseInvoiceFirstTurn(
  message: string,
): InvoiceFirstTurn | null {
  const text = message.trim();
  if (!text || text.length > 300) return null;
  const intent =
    INVOICE_NEW_RE.test(text) ||
    INVOICE_IMPERATIVE_RE.test(text) ||
    BILL_RE.test(text);
  // Scrub email addresses before the exclusion test so meta-words inside
  // a domain ("example" in ada@example.com) never disqualify a request.
  const scrubbed = text.replace(new RegExp(EMAIL_LIKE.source, 'gi'), ' ');
  if (!intent || INVOICE_EXCLUDE_RE.test(scrubbed)) return null;
  const { payeeEmail, amount, currency } = extractMoneyBits(text);
  // Purpose only when a payee anchor AND an amount exist, so "invoice Acme"
  // never mistakes the payee for the purpose. Takes the text after the LAST
  // "for", so "for $450 for flyers" yields "flyers", not "$450 for flyers".
  const purpose = extractPurposeBit(
    text,
    !!(payeeEmail || /\bto\s+[A-Z]/i.test(text)),
    !!amount,
  );
  return {
    ...(payeeEmail ? { payeeEmail } : {}),
    ...(amount ? { amount } : {}),
    ...(currency ? { currency } : {}),
    ...(purpose ? { purpose } : {}),
  };
}

export interface InvoicePendingFields {
  payeeName?: string;
  payeeEmail?: string;
  amount?: string;
  currency?: string;
  purpose?: string;
}

export interface InvoiceFollowUpMerge {
  fields: InvoicePendingFields;
  /** True when the merged draft has everything a draft needs. */
  complete: boolean;
}

const NAME_IS_RE = /\b(?:payee\s+)?name\s+is\s+([^,.;!?]+)/i;
const TO_NAME_RE =
  /\bto\s+([A-Z][A-Za-z .'-]{1,60}?)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/;

/**
 * Merges a follow-up message into a live invoice pending draft. Accepts what
 * parseDraftFollowUp rejects (emails, amounts) plus names and purposes, so a
 * fully-specified reply ("bill ada@x $450 for flyers", "Its for my shoe,
 * name is …") completes without the model. Returns null for new intents,
 * cancellations, and messages with nothing usable — the caller falls through
 * to the model.
 */
export function mergeInvoiceFollowUp(
  pending: InvoicePendingFields,
  message: string,
): InvoiceFollowUpMerge | null {
  const text = message.trim();
  if (!text || text.length > 300) return null;
  if (NEW_INTENT.test(text)) return null;
  if (/^(cancel|stop|never ?mind)\b/i.test(text)) return null;
  const { payeeEmail, amount, currency } = extractMoneyBits(text);
  const payeeName =
    text.match(NAME_IS_RE)?.[1]?.trim() ||
    text.match(TO_NAME_RE)?.[1]?.trim() ||
    undefined;
  const purpose = extractPurposeBit(
    text,
    !!(payeeEmail || pending.payeeEmail || payeeName || pending.payeeName),
    !!(amount || pending.amount),
  );
  if (!payeeEmail && !amount && !payeeName && !purpose) return null;
  const fields: InvoicePendingFields = {
    payeeName: payeeName || pending.payeeName,
    payeeEmail: payeeEmail || pending.payeeEmail,
    amount: amount || pending.amount,
    currency: currency || pending.currency,
    purpose: purpose || pending.purpose,
  };
  const complete = !!(
    fields.payeeName &&
    fields.payeeEmail &&
    fields.amount &&
    fields.purpose
  );
  return { fields, complete };
}

const NEED_LABELS: Record<string, string> = {
  payeeName: "the payee's name",
  payeeEmail: 'the PayPal email',
  amount: 'the amount',
  currency: 'the currency',
  purpose: "what it's for",
};

/**
 * User-facing question for a partially-parsed invoice draft. The tool's own
 * `needs` message is model-facing ("call the tool again"), so the
 * deterministic path asks directly. Phrased so the answer completes
 * deterministically too: name/purpose fragments via parseDraftFollowUp, a
 * bare email via the email-only branch.
 */
export function missingFieldsQuestion(
  needs: string[],
  have: {
    payeeName?: string;
    payeeEmail?: string;
    amount?: string;
    currency?: string;
    purpose?: string;
  },
): string {
  const bits: string[] = [];
  if (have.amount) bits.push(`${have.currency ?? 'USD'} ${have.amount}`);
  if (have.payeeEmail) bits.push(`to ${have.payeeEmail}`);
  if (have.payeeName) bits.push(`payee ${have.payeeName}`);
  if (have.purpose) bits.push(`for ${have.purpose}`);
  const missing = [...new Set(needs)]
    .map((n) => NEED_LABELS[n])
    .filter((l): l is string => !!l);
  const head = bits.length > 0 ? ` — ${bits.join(', ')}` : '';
  if (bits.length === 0) {
    return (
      '🧾 Sure — who should I bill, for how much, and what\'s it for? ' +
      'Include the PayPal email to bill. Reply like: "bill ada@example.com $450 for flyers".'
    );
  }
  if (missing.length === 0) {
    return `🧾 Invoice draft started${head}. Which details did you mean?`;
  }
  const hint =
    needs.includes('payeeName') || needs.includes('purpose')
      ? ' Reply like: "for flyers, name is Ada Obi".'
      : '';
  return `🧾 Invoice draft started${head}. What's ${missing.join(' and ')}?${hint}`;
}

/**
 * Any tool-call-shaped activity in a generateText result: per-step calls
 * plus the top-level buckets, so a model that emits calls the step scan
 * misses never counts as "no tool activity" (the retry gate).
 */
export function hasToolActivity(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as {
    steps?: Array<{ toolCalls?: unknown[] }>;
    toolCalls?: unknown[];
    staticToolCalls?: unknown[];
    dynamicToolCalls?: unknown[];
  };
  for (const bucket of [r.toolCalls, r.staticToolCalls, r.dynamicToolCalls]) {
    if (Array.isArray(bucket) && bucket.length > 0) return true;
  }
  return (Array.isArray(r.steps) ? r.steps : []).some(
    (s) => ((s as { toolCalls?: unknown[] } | null)?.toolCalls?.length ?? 0) > 0,
  );
}

/**
 * Chat memory: durable per-user facts the agent keeps across turns and
 * restarts (preferred name, business, default currency...). Raw conversation
 * lives in AgentMessage; this is the distilled layer. All helpers are pure
 * so the node:test gate pins them without a database.
 */

export interface ChatMemoryEntry {
  key: string;
  value: string;
}

/** snake_case, 1–32 chars: the only key shape remember_fact accepts. */
export const MEMORY_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;

export const MAX_MEMORY_VALUE_CHARS = 500;

/** Suggested keys; the model may coin its own snake_case keys beyond these. */
export const MEMORY_KEY_HINTS = [
  'display_name',
  'business_name',
  'default_currency',
  'timezone',
  'contact_note',
  'communication_style',
] as const;

export function normalizeMemoryKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const normalized = key.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!MEMORY_KEY_RE.test(normalized)) return null;
  return normalized;
}

export function normalizeMemoryValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, MAX_MEMORY_VALUE_CHARS);
  return trimmed || null;
}

/**
 * Prompt block for what the agent remembers about this user. Empty when no
 * facts are stored — never tell the model to invent memories.
 */
/** Max facts auto-captured per turn — the extractor is capped, not the store. */
export const MEMORY_CAPTURE_MAX = 3;

export interface CapturedMemory {
  key: string;
  value: string;
}

/**
 * Prompt for the post-turn extraction pass. Existing memories ride along so
 * the extractor updates rather than duplicates; corrections ("actually I'm
 * in Accra") come back under the same key and upsert over the old value.
 */
export function buildMemoryCapturePrompt(
  userText: string,
  assistantText: string,
  existing: ChatMemoryEntry[],
): string {
  const known =
    existing.length > 0
      ? existing.map((m) => `- ${m.key}: ${m.value}`).join('\n')
      : '(none yet)';
  return [
    'Extract durable facts about the user from this conversation turn.',
    'Durable = true next week: name, business, currency, timezone, recurring clients, preferences, constraints.',
    'NOT durable: one-off requests, amounts, greeting, anything already known (unless the user corrects it).',
    'Reply with a JSON array only, at most 3 items: [{"key": "snake_case", "value": "short fact"}].',
    'Empty array [] when nothing is worth keeping.',
    '',
    `Known memories:\n${known}`,
    '',
    `User: ${userText.slice(0, 800)}`,
    `Assistant: ${assistantText.slice(0, 800)}`,
  ].join('\n');
}

/**
 * Defensive parse of the extractor reply: finds the first [...] JSON array
 * and keeps entries with non-empty string key/value. Never throws — a
 * malformed reply captures nothing.
 */
export function parseMemoryCapture(text: unknown): CapturedMemory[] {
  if (typeof text !== 'string') return [];
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    const out: CapturedMemory[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { key?: unknown }).key === 'string' &&
        typeof (item as { value?: unknown }).value === 'string' &&
        (item as { key: string }).key.trim() &&
        (item as { value: string }).value.trim()
      ) {
        out.push({
          key: (item as { key: string }).key.trim(),
          value: (item as { value: string }).value.trim(),
        });
      }
      if (out.length >= MEMORY_CAPTURE_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Earner briefs — pure verdict/summary helpers. The tools gather rows from
 * Postgres + PayPal; these decide what the rows mean. Tested, deterministic.
 */

export type ClientVerdict = 'new' | 'known-good' | 'caution';

export interface ClientVerdictInput {
  found: boolean;
  payCount?: number;
  blockedCount?: number;
  openDisputeCount?: number;
  changedFlags?: boolean;
}

export function verdictClient(input: ClientVerdictInput): {
  verdict: ClientVerdict;
  notes: string[];
} {
  if (!input.found) {
    return { verdict: 'new', notes: ['first time we see this client'] };
  }
  const notes: string[] = [];
  if ((input.payCount ?? 0) > 0) notes.push(`${input.payCount} payment(s) on record`);
  if ((input.blockedCount ?? 0) > 0) {
    notes.push(`${input.blockedCount} blocked action(s) — read before invoicing`);
  }
  if ((input.openDisputeCount ?? 0) > 0) {
    notes.push(`${input.openDisputeCount} open dispute(s) against you`);
  }
  if (input.changedFlags) notes.push('PayPal details changed before — verify on the card');
  const caution =
    (input.blockedCount ?? 0) > 0 ||
    (input.openDisputeCount ?? 0) > 0 ||
    !!input.changedFlags;
  return { verdict: caution ? 'caution' : 'known-good', notes };
}

export interface ScamCheckSections {
  flaggedActions: number;
  atRiskSubs: number;
  openDisputes: number;
  newPayees: number;
}

/** One honest line over the four scam-check sections. Never throws. */
export function summarizeScamCheck(sections: ScamCheckSections): string {
  const parts: string[] = [];
  if (sections.flaggedActions > 0) {
    parts.push(`${sections.flaggedActions} flagged action(s)`);
  }
  if (sections.atRiskSubs > 0) {
    parts.push(`${sections.atRiskSubs} at-risk subscription(s)`);
  }
  if (sections.openDisputes > 0) {
    parts.push(`${sections.openDisputes} open dispute(s)`);
  }
  if (sections.newPayees > 0) {
    parts.push(`${sections.newPayees} brand-new payee(s)`);
  }
  return parts.length === 0
    ? 'Nothing suspicious in the latest activity.'
    : `Worth a look: ${parts.join(', ')}.`;
}

/** Whole days past a due date as of now; 0 when not overdue. */
export function daysOverdue(due: Date | string, now: Date = new Date()): number {
  const then = due instanceof Date ? due.getTime() : new Date(due).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

export interface DunningRow {
  payeeName: string;
  amount: number;
  currency: string;
  daysOverdue: number;
  reminders: number;
}

export function summarizeDunning(
  overdue: DunningRow[],
  pastDueSubCount: number,
): string {
  if (overdue.length === 0 && pastDueSubCount === 0) {
    return 'Nobody owes you money right now.';
  }
  const top = [...overdue]
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 3)
    .map(
      (r) =>
        `${r.payeeName} (${r.currency} ${r.amount.toFixed(2)}, ${r.daysOverdue}d overdue)`,
    );
  const bits: string[] = [];
  if (overdue.length > 0) {
    const total = overdue.reduce((s, r) => s + r.amount, 0);
    bits.push(
      `${overdue.length} overdue invoice(s) ≈ ${overdue[0].currency} ${total.toFixed(2)}: ${top.join('; ')}`,
    );
  }
  if (pastDueSubCount > 0) {
    bits.push(`${pastDueSubCount} subscription(s) past due`);
  }
  return bits.join('. ') + '.';
}

export function memoryBlockForPrompt(
  memories: ChatMemoryEntry[] | null | undefined,
): string {
  const rows = (memories ?? []).filter(
    (m) => m && normalizeMemoryKey(m.key) && normalizeMemoryValue(m.value),
  );
  if (rows.length === 0) return '';
  const lines = rows.map(
    (m) => `- ${normalizeMemoryKey(m.key)}: ${normalizeMemoryValue(m.value)}`,
  );
  return `What you remember about this user (saved from earlier chats — trust it, don't re-ask):\n${lines.join('\n')}`;
}

/**
 * Char-budget history for the model call: newest turns first until the
 * budget is spent, then back to chronological order. Count alone (MAX_HISTORY
 * rows) can still blow the context when turns carry long tool payloads; the
 * budget keeps the call bounded while always keeping the newest turns.
 */
export function selectHistoryBudget<T extends { content: string }>(
  messages: T[],
  maxChars = 24_000,
): T[] {
  const picked: T[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const len = messages[i].content.length;
    if (picked.length > 0 && used + len > maxChars) break;
    picked.push(messages[i]);
    used += len;
  }
  return picked.reverse();
}

/**
 * Which non-action tool results to surface when the model goes silent after
 * reading: any completed tool result that is NOT a state-changing action.
 * Kept raw here; rendering truncates.
 */
export interface OtherToolResult {
  toolName: string;
  output: unknown;
}

const FRIENDLY_TOOL: Record<string, string> = {
  get_paypal_balance: 'PayPal balance',
  get_account_summary: 'Account summary',
  get_spend: 'Spending',
  search_paypal_transactions: 'Transaction search',
  list_pending: 'Pending queue',
  search_emails: 'Email search',
  lookup_contact: 'Contacts',
  get_safety_policy: 'Safety policy',
  list_blocked_actions: 'Blocked actions',
  get_audit_trail: 'Audit trail',
  recall_memory: 'Saved memory',
  remember_fact: 'Saved memory',
  forget_fact: 'Saved memory',
  list_schedules: 'Schedules',
  list_subscriptions: 'Subscriptions',
  get_subscription: 'Subscription details',
  subscription_report: 'Subscription report',
  list_disputes: 'Disputes',
  get_dispute: 'Dispute details',
  verify_client: 'Client check',
  scam_check: 'Scam check',
  dunning_brief: 'Overdue list',
};

function friendlyToolName(toolName: string): string {
  if (FRIENDLY_TOOL[toolName]) return FRIENDLY_TOOL[toolName];
  if (toolName.startsWith('paypal_')) return 'PayPal lookup';
  return toolName.replace(/_/g, ' ');
}

/** One deterministic line for an arbitrary tool output. Never throws. */
function oneLine(value: unknown, max = 220): string {
  try {
    if (typeof value === 'string') {
      return value.replace(/\s+/g, ' ').trim().slice(0, max) || '(empty)';
    }
    if (typeof value !== 'object' || value === null) {
      return String(value).slice(0, max);
    }
    if (Array.isArray(value)) {
      return value.length === 0
        ? 'none'
        : `${value.length} item(s): ${oneLine(value[0], 120)}`;
    }
    const pairs: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      if (pairs.length >= 4) break;
      if (v === null || v === undefined || typeof v === 'object') continue;
      pairs.push(`${k}: ${String(v).slice(0, 60)}`);
    }
    if (pairs.length > 0) return pairs.join('; ');
    const json = JSON.stringify(value);
    return json.length > max ? `${json.slice(0, max)}…` : json;
  } catch {
    return '(unreadable)';
  }
}

function eachStepTool<T>(
  result: unknown,
  pick: (step: {
    toolCalls?: Array<{ toolName?: unknown } & Record<string, unknown>>;
    toolResults?: Array<
      { toolName?: unknown; output?: unknown; result?: unknown } &
        Record<string, unknown>
    >;
  }) => T[],
): T[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as {
    steps?: unknown;
    toolResults?: unknown;
    toolCalls?: unknown;
  };
  const out: T[] = [];
  if (Array.isArray(r.steps)) {
    for (const step of r.steps) {
      if (step && typeof step === 'object') {
        out.push(
          ...pick(
            step as {
              toolCalls?: Array<{ toolName?: unknown } & Record<string, unknown>>;
              toolResults?: Array<
                { toolName?: unknown; output?: unknown; result?: unknown } &
                  Record<string, unknown>
              >;
            },
          ),
        );
      }
    }
  }
  return out;
}

/**
 * True when the model issued (or completed) a state-changing action tool.
 * The empty-reply retry must never fire then — a second attempt could
 * draft twice, remind twice, or schedule twice. Read-only tools are safe
 * to retry: they change nothing.
 */
export function hasActionActivity(
  result: unknown,
  actionNames: ReadonlySet<string> | readonly string[],
): boolean {
  const set = actionNames instanceof Set ? actionNames : new Set(actionNames);
  const calls = eachStepTool(result, (step) => step.toolCalls ?? []);
  if (calls.some((c) => typeof c.toolName === 'string' && set.has(c.toolName))) {
    return true;
  }
  const results = eachStepTool(result, (step) => step.toolResults ?? []);
  return results.some(
    (t) => typeof t.toolName === 'string' && set.has(t.toolName),
  );
}

/**
 * Completed non-action tool results, oldest first, capped. Rendered only
 * when the model goes silent after reading, so a lookup never degrades to
 * the amnesiac "I'm here" fallback.
 */
export function collectNonActionResults(
  result: unknown,
  actionNames: ReadonlySet<string> | readonly string[],
  maxItems = 4,
): OtherToolResult[] {
  const set = actionNames instanceof Set ? actionNames : new Set(actionNames);
  const found = eachStepTool(result, (step) => step.toolResults ?? []);
  const out: OtherToolResult[] = [];
  for (const t of found) {
    if (out.length >= maxItems) break;
    if (!t || typeof t.toolName !== 'string' || set.has(t.toolName)) continue;
    const output =
      'output' in t && t.output !== undefined ? t.output : t.result;
    out.push({ toolName: t.toolName, output: output ?? null });
  }
  return out;
}

/**
 * Honest fallback for "read tools ran, model said nothing": show the facts
 * instead of greeting the user like a stranger. Null when there is nothing
 * to show — the caller keeps the canned line as the last resort.
 */
export function describeNonActionResults(
  items: OtherToolResult[] | null | undefined,
): string | null {
  const rows = (items ?? []).filter(
    (it) => it && typeof it.toolName === 'string',
  );
  if (rows.length === 0) return null;
  const lines = rows
    .slice(0, 4)
    .map((it) => `• ${friendlyToolName(it.toolName)}: ${oneLine(it.output)}`);
  return (
    "I looked that up but couldn't phrase the answer. Here's what I found:\n" +
    `${lines.join('\n')}\nAsk me to explain any of it.`
  );
}

/**
 * One-line shape summary for an empty model result: finish reasons, per-step
 * text/call/result counts, warnings, usage. Logged with the retry warning so
 * the next silent turn explains itself instead of just falling back.
 */
export function summarizeEmptyResult(result: unknown): string {
  if (!result || typeof result !== 'object') return 'no result';
  const r = result as {
    finishReason?: unknown;
    steps?: Array<{
      text?: unknown;
      toolCalls?: unknown[];
      toolResults?: unknown[];
      finishReason?: unknown;
    }>;
    warnings?: unknown[];
    usage?: unknown;
  };
  const steps = Array.isArray(r.steps) ? r.steps : [];
  const bits = steps.slice(0, 6).map((s, i) => {
    const textLen = typeof s?.text === 'string' ? s.text.length : 0;
    const calls = s?.toolCalls?.length ?? 0;
    const results = s?.toolResults?.length ?? 0;
    const finish = typeof s?.finishReason === 'string' ? s.finishReason : '?';
    return `#${i} text=${textLen} calls=${calls} results=${results} finish=${finish}`;
  });
  const finish =
    typeof r.finishReason === 'string' ? r.finishReason : 'unknown';
  const warnings = Array.isArray(r.warnings) ? r.warnings.length : 0;
  let usage = 'n/a';
  try {
    if (r.usage && typeof r.usage === 'object') {
      usage = JSON.stringify(r.usage).slice(0, 120);
    }
  } catch {
    usage = 'unserializable';
  }
  return `finish=${finish} steps=${steps.length}[${bits.join(' ')}] warnings=${warnings} usage=${usage}`;
}
