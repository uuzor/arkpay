/**
 * Payment Safety Engine — the pure policy layer.
 *
 * This file deliberately has no Nest, Prisma or network dependency: every
 * verdict is a deterministic function of the action, the contact history and
 * the pre-computed aggregates. Both gates call the same evaluator so a card
 * that was shown to a human and an execution hours later cannot disagree
 * about the rules.
 *
 * The policy version is returned with every verdict and persisted in the
 * action + audit row. Change the version whenever a rule changes; never edit
 * history.
 */

export const SAFETY_POLICY_VERSION = 'arkpay-policy-2026-11-04';

export type SafetyActionType = 'INVOICE' | 'PAYOUT_SINGLE' | 'PAYOUT_BATCH';

export type SafetyVerdictKind = 'ALLOW' | 'NEEDS_CONFIRMATION' | 'BLOCK';

export type SafetyFlag =
  | 'NEW_PAYEE'
  | 'PAYEE_CHANGED'
  | 'DUPLICATE'
  | 'AMOUNT_ANOMALY'
  | 'INJECTION_SIGNAL'
  | 'URGENCY'
  | 'CURRENCY_NOT_ALLOWED'
  | 'INVALID_PAYEE_EMAIL'
  | 'AMOUNT_INVALID'
  | 'AMOUNT_CAP_EXCEEDED'
  | 'VENDOR_CAP_EXCEEDED'
  | 'GLOBAL_CAP_EXCEEDED'
  | 'BATCH_SIZE_EXCEEDED'
  | 'BATCH_TOTAL_EXCEEDED'
  | 'DUE_DATE_INVALID'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_HASH_MISMATCH'
  | 'APPROVAL_VERSION_MISMATCH'
  | 'APPROVER_NOT_LINKED';

export interface SafetyContact {
  id?: string;
  name?: string;
  paypalEmail?: string | null;
  kind?: string | null;
  payCount?: number;
  usualAmount?: number | string | null;
  currency?: string | null;
}

export interface SafetyHistory {
  /** Same payee + amount + currency inside the duplicate window, excluding self. */
  duplicateCount?: number;
  /** Payout money already committed today, same currency and payee. */
  vendorSpentToday?: number;
  /** Payout money already committed today, same currency, all payees. */
  globalSpentToday?: number;
  /** Batch size including the current member. */
  batchSize?: number;
  /** Batch total including the current member. */
  batchTotal?: number;
}

export interface SafetyApproval {
  expectedHash?: string | null;
  actualHash?: string | null;
  approvedVersion?: number | null;
  version?: number | null;
  expiresAt?: Date | string | null;
  approvedBy?: string | null;
  expectedApprover?: string | null;
  now?: Date | string;
}

export interface SafetyEvaluationInput {
  type: SafetyActionType;
  payeeName: string;
  payeePaypal: string;
  amount: number | string;
  currency: string;
  purpose: string;
  dueDate?: Date | string | null;
  contact?: SafetyContact | null;
  /** Signals supplied by the extraction model. */
  extractedSignals?: string[] | null;
  /** The raw email / chat text, already treated as untrusted data. */
  sourceText?: string | null;
  /** Existing flags on the action, preserved across a re-evaluation. */
  riskFlags?: string[] | null;
  history?: SafetyHistory | null;
  approval?: SafetyApproval | null;
}

export interface SafetyPolicyConfig {
  currencyAllowlist: string[];
  autoApproveMaxAmount: number;
  vendorDailyCap: number;
  globalDailyCap: number;
  invoiceMaxAmount: number;
  batchMaxItems: number;
  batchMaxTotal: number;
  duplicateWindowHours: number;
  amountAnomalyFactor: number;
  dueDateMaxDays: number;
}

export const DEFAULT_SAFETY_POLICY: SafetyPolicyConfig = {
  currencyAllowlist: ['USD', 'EUR', 'GBP', 'NGN', 'CAD', 'AUD'],
  autoApproveMaxAmount: 0,
  vendorDailyCap: 500,
  globalDailyCap: 2000,
  invoiceMaxAmount: 10000,
  batchMaxItems: 20,
  batchMaxTotal: 5000,
  duplicateWindowHours: 24,
  amountAnomalyFactor: 2,
  dueDateMaxDays: 365,
};

/**
 * §6 payee axis. Derived from the same flags the verdict reports, so the
 * approval card and the execution gate can never disagree about it.
 */
export type PayeeStatus = 'KNOWN' | 'NEW' | 'CHANGED';

/** §6 cell outcomes. */
export type PolicyCellOutcome =
  | 'ALLOW_UNDER_LIMIT'
  | 'APPROVE'
  | 'APPROVE_EXTRA_CONFIRMATION'
  | 'BLOCK_MANUAL_OVERRIDE_ONLY';

export interface PolicyMatrixCell {
  ruleId: string;
  outcome: PolicyCellOutcome;
  note: string;
}

/**
 * idea.md §6 execution policy: rows are action types, columns are payee
 * status. Data, not prose — every verdict cites the cell that decided it.
 * Caps and invalid fields may only make a decision stricter, never looser.
 */
export const POLICY_MATRIX: Readonly<
  Record<SafetyActionType, Record<PayeeStatus, PolicyMatrixCell>>
> = Object.freeze({
  INVOICE: Object.freeze({
    KNOWN: Object.freeze({
      ruleId: 'M-INVOICE-KNOWN',
      outcome: 'ALLOW_UNDER_LIMIT',
      note: 'Allow under the user limit, else manual approval.',
    }),
    NEW: Object.freeze({
      ruleId: 'M-INVOICE-NEW',
      outcome: 'APPROVE',
      note: 'Manual approval for a first-time payee.',
    }),
    CHANGED: Object.freeze({
      ruleId: 'M-INVOICE-CHANGED',
      outcome: 'APPROVE',
      note: 'Manual approval, and the card shows what changed.',
    }),
  }),
  PAYOUT_SINGLE: Object.freeze({
    KNOWN: Object.freeze({
      ruleId: 'M-PAYOUT-SINGLE-KNOWN',
      outcome: 'ALLOW_UNDER_LIMIT',
      note: 'Allow under the user limit and daily caps, else manual approval.',
    }),
    NEW: Object.freeze({
      ruleId: 'M-PAYOUT-SINGLE-NEW',
      outcome: 'APPROVE_EXTRA_CONFIRMATION',
      note: 'Approve with extra confirmation: re-enter the amount.',
    }),
    CHANGED: Object.freeze({
      ruleId: 'M-PAYOUT-SINGLE-CHANGED',
      outcome: 'BLOCK_MANUAL_OVERRIDE_ONLY',
      note: 'Blocked. Only a new action, manually approved, may pay.',
    }),
  }),
  PAYOUT_BATCH: Object.freeze({
    KNOWN: Object.freeze({
      ruleId: 'M-PAYOUT-BATCH-KNOWN',
      outcome: 'APPROVE',
      note: 'Always manual, with total and every recipient shown.',
    }),
    NEW: Object.freeze({
      ruleId: 'M-PAYOUT-BATCH-NEW',
      outcome: 'APPROVE_EXTRA_CONFIRMATION',
      note: 'Approve with extra confirmation for new members.',
    }),
    CHANGED: Object.freeze({
      ruleId: 'M-PAYOUT-BATCH-CHANGED',
      outcome: 'BLOCK_MANUAL_OVERRIDE_ONLY',
      note: 'Blocked. Only a new action, manually approved, may pay.',
    }),
  }),
});

export interface NeverRule {
  id: string;
  description: string;
  /** Flags whose presence means this rule fired. */
  readonly enforcedByFlags: readonly SafetyFlag[];
}

/**
 * §6 NEVER rules. No evaluator input, workspace override or approval can
 * bypass these — a blocked action dies and a human creates a NEW action.
 * Single-use of approvals is enforced by the approvals service consuming the
 * approval row inside the execution transaction.
 */
export const NEVER_RULES: readonly NeverRule[] = Object.freeze([
  Object.freeze({
    id: 'NEVER-STALE-APPROVAL',
    description: 'Never execute on an expired or already-used approval.',
    enforcedByFlags: ['APPROVAL_EXPIRED' as SafetyFlag, 'APPROVAL_VERSION_MISMATCH' as SafetyFlag],
  }),
  Object.freeze({
    id: 'NEVER-EDIT-AFTER-APPROVAL',
    description:
      'Never change payee, amount, currency, or purpose after approval; edits void it.',
    enforcedByFlags: ['APPROVAL_HASH_MISMATCH' as SafetyFlag],
  }),
  Object.freeze({
    id: 'NEVER-EXCEED-CAPS',
    description: 'Never exceed per-vendor, per-day, or batch caps.',
    enforcedByFlags: [
      'AMOUNT_CAP_EXCEEDED' as SafetyFlag,
      'VENDOR_CAP_EXCEEDED' as SafetyFlag,
      'GLOBAL_CAP_EXCEEDED' as SafetyFlag,
      'BATCH_SIZE_EXCEEDED' as SafetyFlag,
      'BATCH_TOTAL_EXCEEDED' as SafetyFlag,
    ],
  }),
  Object.freeze({
    id: 'NEVER-RAW-MODEL-OUTPUT',
    description: 'Never let model output reach PayPal without code validation.',
    enforcedByFlags: [
      'CURRENCY_NOT_ALLOWED' as SafetyFlag,
      'INVALID_PAYEE_EMAIL' as SafetyFlag,
      'AMOUNT_INVALID' as SafetyFlag,
      'DUE_DATE_INVALID' as SafetyFlag,
    ],
  }),
]);

export interface SafetyVerdict {
  verdict: SafetyVerdictKind;
  /** §6 payee axis used for the matrix lookup. */
  payeeStatus: PayeeStatus;
  /** Matrix cell + fired NEVER rule ids. First entry is always the cell. */
  ruleIds: string[];
  /** §6: new-payee payouts need the amount re-entered before approval. */
  extraConfirmationRequired: boolean;
  flags: SafetyFlag[];
  reasons: string[];
  policyVersion: string;
  summary: string;
  autoApproveEligible: boolean;
}

const FLAG_ORDER: SafetyFlag[] = [
  'PAYEE_CHANGED',
  'NEW_PAYEE',
  'DUPLICATE',
  'AMOUNT_ANOMALY',
  'INJECTION_SIGNAL',
  'URGENCY',
  'CURRENCY_NOT_ALLOWED',
  'INVALID_PAYEE_EMAIL',
  'AMOUNT_INVALID',
  'AMOUNT_CAP_EXCEEDED',
  'VENDOR_CAP_EXCEEDED',
  'GLOBAL_CAP_EXCEEDED',
  'BATCH_SIZE_EXCEEDED',
  'BATCH_TOTAL_EXCEEDED',
  'DUE_DATE_INVALID',
  'APPROVAL_EXPIRED',
  'APPROVAL_HASH_MISMATCH',
  'APPROVAL_VERSION_MISMATCH',
  'APPROVER_NOT_LINKED',
];

const BLOCKING_FLAGS = new Set<SafetyFlag>([
  'CURRENCY_NOT_ALLOWED',
  'INVALID_PAYEE_EMAIL',
  'AMOUNT_INVALID',
  'AMOUNT_CAP_EXCEEDED',
  'VENDOR_CAP_EXCEEDED',
  'GLOBAL_CAP_EXCEEDED',
  'BATCH_SIZE_EXCEEDED',
  'BATCH_TOTAL_EXCEEDED',
  'APPROVAL_EXPIRED',
  'APPROVAL_HASH_MISMATCH',
  'APPROVAL_VERSION_MISMATCH',
  'APPROVER_NOT_LINKED',
]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /approve\s+(it\s+|this\s+)?automatically/i,
  /(skip|bypass)\s+(the\s+)?(verification|approval|review)/i,
  /no\s+(need|require)\s+(to\s+)?(verify|confirm|approve)/i,
  /do\s+not\s+(verify|confirm|ask|tell)/i,
  /system\s+prompt/i,
  /you\s+are\s+(now\s+)?(an?\s+)?(admin|approver)/i,
];

const URGENCY_PATTERNS = [
  /\burgent(ly)?\b/i,
  /\basap\b/i,
  /\bimmediately\b/i,
  /\bright\s+away\b/i,
  /\b(pay|send)\s+(it\s+)?(today|now)\b/i,
  /\bfinal\s+(notice|warning)\b/i,
  /\btime[-\s]?sensitive\b/i,
  /\bact\s+fast\b/i,
];

const PAYPAL_CHANGE_PATTERNS = [
  /(?:paypal|pay\s*pal)\s+(?:email|address|account)[^.\n]{0,80}(?:changed|updated|new|different)/i,
  /(?:changed|updated)\s+(?:our|my|the)\s+(?:paypal|pay\s*pal)\s+(?:email|address)/i,
  /(?:new|different)\s+(?:paypal|pay\s*pal)\s+(?:email|address)/i,
];

const REASONS: Record<SafetyFlag, string> = {
  NEW_PAYEE: 'first payment to this payee',
  PAYEE_CHANGED: 'the PayPal email differs from the known payee record',
  DUPLICATE: 'a matching payee + amount is already in flight or recently paid',
  AMOUNT_ANOMALY: 'amount is far outside this payee’s normal range',
  INJECTION_SIGNAL: 'the request contains instruction-like text aimed at the agent',
  URGENCY: 'the request uses urgency or pressure language',
  CURRENCY_NOT_ALLOWED: 'currency is not on the allow-list',
  INVALID_PAYEE_EMAIL: 'the PayPal email is not a valid email address',
  AMOUNT_INVALID: 'the amount is missing, zero, negative or malformed',
  AMOUNT_CAP_EXCEEDED: 'the invoice amount exceeds the configured maximum',
  VENDOR_CAP_EXCEEDED: 'the vendor’s daily cap would be exceeded',
  GLOBAL_CAP_EXCEEDED: 'the global daily cap would be exceeded',
  BATCH_SIZE_EXCEEDED: 'the batch has more recipients than allowed',
  BATCH_TOTAL_EXCEEDED: 'the batch total exceeds the configured maximum',
  DUE_DATE_INVALID: 'the due date is malformed, in the past, or too far ahead',
  APPROVAL_EXPIRED: 'the approval has expired',
  APPROVAL_HASH_MISMATCH: 'the stored action no longer matches what was approved',
  APPROVAL_VERSION_MISMATCH: 'the approval belongs to an older version of the action',
  APPROVER_NOT_LINKED: 'the recorded approver is not the linked approver',
};

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((v): v is T => v !== null && v !== undefined);
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function textMatches(text: string | null | undefined, patterns: RegExp[]): boolean {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * THE policy evaluator. Pure: no I/O, no clock except input.approval.now.
 * Callers supply history aggregates; this function decides.
 */
export function evaluateSafety(
  input: SafetyEvaluationInput,
  config: SafetyPolicyConfig = DEFAULT_SAFETY_POLICY,
): SafetyVerdict {
  const found = new Set<SafetyFlag>();
  for (const flag of input.riskFlags ?? []) {
    if (FLAG_ORDER.includes(flag as SafetyFlag)) {
      found.add(flag as SafetyFlag);
    }
  }
  const payeeEmail = normalizeEmail(input.payeePaypal);
  const currency = input.currency?.trim().toUpperCase() ?? '';
  const amount = Number(input.amount);
  const contact = input.contact ?? null;
  const payCount = contact?.payCount ?? 0;
  const known = payCount > 0;
  const expectedEmail = normalizeEmail(contact?.paypalEmail);
  const payeeChanged =
    known && expectedEmail !== '' && payeeEmail !== expectedEmail;
  const changeLanguage = textMatches(input.sourceText, PAYPAL_CHANGE_PATTERNS);
  const history = input.history ?? {};
  const approval = input.approval ?? null;

  if (known && (payeeChanged || changeLanguage)) found.add('PAYEE_CHANGED');
  if (!known) found.add('NEW_PAYEE');

  if (known && contact?.usualAmount != null) {
    const usual = Number(contact.usualAmount);
    if (Number.isFinite(usual) && usual > 0 && Number.isFinite(amount)) {
      const ratio = amount / usual;
      const factor = config.amountAnomalyFactor > 1 ? config.amountAnomalyFactor : 2;
      if (ratio > factor || ratio < 1 / factor) found.add('AMOUNT_ANOMALY');
    }
  }

  if ((input.extractedSignals?.length ?? 0) > 0) found.add('INJECTION_SIGNAL');
  if (textMatches(input.sourceText, INJECTION_PATTERNS)) {
    found.add('INJECTION_SIGNAL');
  }
  if (textMatches(input.sourceText, URGENCY_PATTERNS)) found.add('URGENCY');

  if (!config.currencyAllowlist.includes(currency)) {
    found.add('CURRENCY_NOT_ALLOWED');
  }
  if (!EMAIL_RE.test(payeeEmail)) found.add('INVALID_PAYEE_EMAIL');
  if (!Number.isFinite(amount) || amount <= 0) found.add('AMOUNT_INVALID');

  const dueDate = asDate(input.dueDate);
  if (input.dueDate != null) {
    if (!dueDate) {
      found.add('DUE_DATE_INVALID');
    } else {
      const now = asDate(approval?.now) ?? new Date();
      const startOfToday = new Date(now);
      startOfToday.setUTCHours(0, 0, 0, 0);
      const maxAhead = new Date(now.getTime() + config.dueDateMaxDays * 86_400_000);
      if (dueDate.getTime() < startOfToday.getTime() || dueDate > maxAhead) {
        found.add('DUE_DATE_INVALID');
      }
    }
  }

  if ((history.duplicateCount ?? 0) > 0) found.add('DUPLICATE');

  if (input.type === 'INVOICE') {
    if (Number.isFinite(amount) && amount > config.invoiceMaxAmount) {
      found.add('AMOUNT_CAP_EXCEEDED');
    }
  } else {
    const vendorLimit = config.vendorDailyCap;
    const globalLimit = config.globalDailyCap;
    if (
      Number.isFinite(amount) &&
      (history.vendorSpentToday ?? 0) + amount > vendorLimit
    ) {
      found.add('VENDOR_CAP_EXCEEDED');
    }
    if (
      Number.isFinite(amount) &&
      (history.globalSpentToday ?? 0) + amount > globalLimit
    ) {
      found.add('GLOBAL_CAP_EXCEEDED');
    }
  }

  if (input.type === 'PAYOUT_BATCH') {
    if ((history.batchSize ?? 0) > config.batchMaxItems) {
      found.add('BATCH_SIZE_EXCEEDED');
    }
    if ((history.batchTotal ?? 0) > config.batchMaxTotal) {
      found.add('BATCH_TOTAL_EXCEEDED');
    }
  }

  if (approval) {
    const expiresAt = asDate(approval.expiresAt);
    const now = asDate(approval.now) ?? new Date();
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      found.add('APPROVAL_EXPIRED');
    }
    if (
      approval.expectedHash &&
      approval.actualHash &&
      approval.expectedHash !== approval.actualHash
    ) {
      found.add('APPROVAL_HASH_MISMATCH');
    }
    if (
      approval.approvedVersion !== null &&
      approval.approvedVersion !== undefined &&
      approval.version !== null &&
      approval.version !== undefined &&
      approval.approvedVersion !== approval.version
    ) {
      found.add('APPROVAL_VERSION_MISMATCH');
    }
    if (
      approval.approvedBy &&
      approval.expectedApprover &&
      approval.approvedBy !== approval.expectedApprover
    ) {
      found.add('APPROVER_NOT_LINKED');
    }
  }

  // idea.md §6: the action x payee-status matrix decides the baseline cell;
  // caps and invalid fields may only make the decision stricter, never
  // looser. The payee axis comes from the same flags the verdict reports,
  // so the approval card and the execution gate cannot disagree about it.
  const flags = FLAG_ORDER.filter((flag) => found.has(flag));
  const payeeStatus: PayeeStatus = found.has('PAYEE_CHANGED')
    ? 'CHANGED'
    : known
      ? 'KNOWN'
      : 'NEW';
  const cell = POLICY_MATRIX[input.type][payeeStatus];
  const blocking = flags.filter((flag) => BLOCKING_FLAGS.has(flag));
  const cellBlocks = cell.outcome === 'BLOCK_MANUAL_OVERRIDE_ONLY';

  let verdict: SafetyVerdictKind;
  if (blocking.length > 0 || cellBlocks) verdict = 'BLOCK';
  else if (flags.length > 0 || cell.outcome !== 'ALLOW_UNDER_LIMIT')
    verdict = 'NEEDS_CONFIRMATION';
  else verdict = 'ALLOW';

  const firedNeverRules = NEVER_RULES.filter((rule) =>
    rule.enforcedByFlags.some((flag) => found.has(flag)),
  ).map((rule) => rule.id);
  const ruleIds = [cell.ruleId, ...firedNeverRules];
  const extraConfirmationRequired =
    cell.outcome === 'APPROVE_EXTRA_CONFIRMATION';

  const reasons = flags.map((flag) => REASONS[flag]);
  const summary =
    reasons.length === 0
      ? verdict === 'NEEDS_CONFIRMATION'
        ? `Manual approval by policy: ${cell.note}`
        : 'All safety checks passed.'
      : `${verdict === 'BLOCK' ? 'Blocked' : 'Needs confirmation'}: ${reasons.join('; ')}.`;

  // §6: "allow under limit" means the user limit gates the cell — anything
  // above the auto-approve limit needs a human regardless of cell.
  const autoApproveEligible =
    verdict === 'ALLOW' &&
    cell.outcome === 'ALLOW_UNDER_LIMIT' &&
    config.autoApproveMaxAmount > 0 &&
    amount > 0 &&
    amount <= config.autoApproveMaxAmount &&
    payeeStatus === 'KNOWN' &&
    flags.length === 0;

  return {
    verdict,
    payeeStatus,
    ruleIds,
    extraConfirmationRequired,
    flags,
    reasons,
    policyVersion: SAFETY_POLICY_VERSION,
    summary,
    autoApproveEligible,
  };
}

export const POLICY_RULES = [
  'Rows are actions, columns are payee status; every verdict cites the matrix cell (M-*) that decided it. See POLICY_MATRIX.',
  'Four NEVER rules (NEVER-*) have no override inside a run: stale approvals, post-approval edits, caps, unvalidated model output. A human must create a new action.',
  'Human approval is the default; auto-approval is opt-in and never applies to new or changed payees.',
  'A known payee with a different PayPal email is BLOCKED for payouts; for invoices it needs confirmation and is shown on the card.',
  'New payees always require manual confirmation.',
  'Currency must be on the allow-list; invalid emails, amounts and due dates are flagged.',
  'Per-vendor, per-day, invoice maximum, batch size and batch total caps are hard blocks.',
  'Duplicate payee + amount + currency requests inside the window need confirmation.',
  'Instruction-like text and urgency are surfaced as risk signals; they never become instructions.',
  'Approval hash, version, expiry and approver identity are re-checked at execution.',
  'No money moves on a BLOCK: the action never reaches the approve path.',
];
