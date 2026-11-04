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
// Anything that reads, revisits, or undoes an invoice — never a new draft.
const INVOICE_EXCLUDE_RE =
  /follow.?up|resend|re-send|forward|cancel|void|delete|refund|status|audit|block|dispute|remind|paid|overdue|history|list|show/i;
const MONEY_HINT_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[$€£₦]|\b(?:usd|eur|gbp|ngn)\b|[\d,]+\.\d{1,2}|\bof\s+[\d,]+/i;
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
  if (toolName !== 'create_invoice_draft' && toolName !== 'request_payout') {
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
  return `💸 Payout drafted for ${facts}. Nothing moves until you tap Pay.`;
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

/**
 * Deterministic first-turn parse for NEW invoice requests ("Send invoice to
 * Ada (ada@x) for $450 for flyers"). Returns null when the message is not a
 * new-invoice intent, so the caller falls through to the model. Conservative
 * by design: mails that read, revisit, or undo an invoice never match, and
 * the payee name is left to the service merge (it owns the contact rules).
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
  if (!intent || INVOICE_EXCLUDE_RE.test(text)) return null;
  if (!MONEY_HINT_RE.test(text)) return null;
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
  // Purpose only when a payee anchor AND an amount exist, so "invoice Acme"
  // never mistakes the payee for the purpose. Takes the text after the LAST
  // "for", so "for $450 for flyers" yields "flyers", not "$450 for flyers".
  let purpose: string | undefined;
  if ((payeeEmail || /\bto\s+[A-Z]/i.test(text)) && amount) {
    const segments = text.split(/\bfor\s+/i);
    const candidate =
      segments.length > 1
        ? segments[segments.length - 1].trim().replace(/[.;!?]+$/, '')
        : undefined;
    if (
      candidate &&
      candidate.length <= 120 &&
      !/[@$€£₦]/.test(candidate) &&
      !/\b(?:usd|eur|gbp|ngn)\b/i.test(candidate) &&
      !/\d/.test(candidate)
    ) {
      purpose = candidate;
    }
  }
  if (!payeeEmail && !amount) return null;
  return {
    ...(payeeEmail ? { payeeEmail } : {}),
    ...(amount ? { amount } : {}),
    ...(currency ? { currency } : {}),
    ...(purpose ? { purpose } : {}),
  };
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
