/**
 * Subscription + dispute analysis — pure functions, no Nest/Prisma/network.
 * The agent tools call these to turn raw PayPal shapes into flags, risk
 * lists and suggested next actions. The model narrates; code decides.
 */

export interface SubscriptionFacts {
  id: string;
  status: string;
  subscriberEmail?: string;
  subscriberName?: string;
  lastPaymentAmount?: string;
  lastPaymentCurrency?: string;
  lastPaymentTime?: string;
  nextBillingTime?: string;
  failedPaymentsCount?: number;
  outstandingBalance?: string;
  outstandingCurrency?: string;
}

export type SubscriptionFlag =
  | 'FAILED_PAYMENTS'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'STALE_ACTIVE';

export interface SubscriptionAssessment {
  id: string;
  flags: SubscriptionFlag[];
  /** Days since the last successful payment, when known. */
  daysSincePayment?: number;
  summary: string;
}

/** Active but nothing paid in this long: billing is probably stuck. */
export const STALE_ACTIVE_DAYS = 45;

/** Outstanding balance above this (any currency unit) counts as past due. */
const PAST_DUE_EPSILON = 0.005;

export function assessSubscription(
  sub: SubscriptionFacts,
  now: Date = new Date(),
): SubscriptionAssessment {
  const flags: SubscriptionFlag[] = [];
  if ((sub.failedPaymentsCount ?? 0) > 0) flags.push('FAILED_PAYMENTS');
  const outstanding = Number(sub.outstandingBalance ?? 0);
  if (Number.isFinite(outstanding) && outstanding > PAST_DUE_EPSILON) {
    flags.push('PAST_DUE');
  }
  if (sub.status === 'SUSPENDED') flags.push('SUSPENDED');
  let daysSincePayment: number | undefined;
  if (sub.lastPaymentTime) {
    const paid = new Date(sub.lastPaymentTime).getTime();
    if (Number.isFinite(paid)) {
      daysSincePayment = Math.max(
        0,
        Math.floor((now.getTime() - paid) / 86_400_000),
      );
      if (sub.status === 'ACTIVE' && daysSincePayment > STALE_ACTIVE_DAYS) {
        flags.push('STALE_ACTIVE');
      }
    }
  }
  const who = sub.subscriberName || sub.subscriberEmail || sub.id;
  const summary =
    flags.length === 0
      ? `${who}: healthy (${sub.status}).`
      : `${who}: ${flags
          .map((f) => FLAG_LABELS[f])
          .join('; ')}.`;
  return { id: sub.id, flags, daysSincePayment, summary };
}

const FLAG_LABELS: Record<SubscriptionFlag, string> = {
  FAILED_PAYMENTS: 'payments failing',
  PAST_DUE: 'balance past due',
  SUSPENDED: 'suspended',
  STALE_ACTIVE: 'active but nothing paid recently',
};

export interface PortfolioReport {
  total: number;
  byStatus: Record<string, number>;
  /** Sum of last-payment amounts over ACTIVE subs, per currency. */
  activeMrr: Record<string, string>;
  pastDueTotal: Record<string, string>;
  atRisk: SubscriptionAssessment[];
  /** ACTIVE with no flags. Inactive-but-clean subs are neither. */
  healthy: number;
}

/**
 * Portfolio rollup over one page of subscriptions: status counts, an MRR
 * estimate from last payments, past-due exposure, and the at-risk list.
 * Amounts are estimates (last payment ≈ plan price) and labelled as such.
 */
export function summarizePortfolio(
  subs: SubscriptionFacts[],
  now: Date = new Date(),
): PortfolioReport {
  const byStatus: Record<string, number> = {};
  const activeMrr: Record<string, number> = {};
  const pastDueTotal: Record<string, number> = {};
  const atRisk: SubscriptionAssessment[] = [];
  let healthy = 0;
  for (const sub of subs) {
    byStatus[sub.status] = (byStatus[sub.status] ?? 0) + 1;
    const assessed = assessSubscription(sub, now);
    if (assessed.flags.length > 0) atRisk.push(assessed);
    else if (sub.status === 'ACTIVE') healthy += 1;
    if (sub.status === 'ACTIVE') {
      const amount = Number(sub.lastPaymentAmount ?? NaN);
      const currency = sub.lastPaymentCurrency;
      if (currency && Number.isFinite(amount) && amount > 0) {
        activeMrr[currency] = (activeMrr[currency] ?? 0) + amount;
      }
    }
    const overdue = Number(sub.outstandingBalance ?? 0);
    const overdueCurrency = sub.outstandingCurrency;
    if (
      overdueCurrency &&
      Number.isFinite(overdue) &&
      overdue > PAST_DUE_EPSILON
    ) {
      pastDueTotal[overdueCurrency] =
        (pastDueTotal[overdueCurrency] ?? 0) + overdue;
    }
  }
  // At-risk first: failing payments, then past due, then the rest.
  const rank = (a: SubscriptionAssessment): number =>
    a.flags.includes('FAILED_PAYMENTS')
      ? 0
      : a.flags.includes('PAST_DUE')
        ? 1
        : 2;
  atRisk.sort((a, b) => rank(a) - rank(b));
  const fixed = (record: Record<string, number>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(record).map(([k, v]) => [k, v.toFixed(2)]),
    );
  return {
    total: subs.length,
    byStatus,
    activeMrr: fixed(activeMrr),
    pastDueTotal: fixed(pastDueTotal),
    atRisk,
    healthy,
  };
}

export interface DisputeFacts {
  id: string;
  reason?: string;
  status?: string;
  state?: string;
  lifeCycleStage?: string;
  amount?: string;
  currency?: string;
  updateTime?: string;
  links: string[];
}

export type DisputeSuggestion =
  | 'send_message'
  | 'make_offer'
  | 'provide_evidence'
  | 'accept_claim'
  | 'wait_paypal'
  | 'none';

export interface DisputeAssessment {
  id: string;
  /** What PayPal currently allows, derived from HATEOAS links. */
  allowed: DisputeSuggestion[];
  /** The single best next step, or why there is none. */
  suggestion: DisputeSuggestion;
  reason: string;
}

/**
 * Best next step from the dispute's own HATEOAS links — the model never
 * guesses legality. Inquiry-stage disputes want a message first; claim-stage
 * disputes waiting on the seller want evidence; offers are suggested only
 * when PayPal lists them.
 */
export function assessDispute(dispute: DisputeFacts): DisputeAssessment {
  const links = new Set(dispute.links);
  const allowed: DisputeSuggestion[] = [];
  if (links.has('send-message')) allowed.push('send_message');
  if (links.has('make-offer')) allowed.push('make_offer');
  if (links.has('provide-evidence')) allowed.push('provide_evidence');
  if (links.has('accept-claim')) allowed.push('accept_claim');
  if (
    dispute.state === 'UNDER_PAYPAL_REVIEW' ||
    dispute.status === 'UNDER_REVIEW'
  ) {
    allowed.push('wait_paypal');
  }
  let suggestion: DisputeSuggestion = 'none';
  let reason = 'No seller action is available on this dispute right now.';
  if (dispute.lifeCycleStage === 'INQUIRY' && links.has('send-message')) {
    suggestion = 'send_message';
    reason =
      'Inquiry stage: a direct reply to the buyer is the fastest resolution.';
  } else if (
    dispute.status === 'WAITING_FOR_SELLER_RESPONSE' &&
    links.has('provide-evidence')
  ) {
    suggestion = 'provide_evidence';
    reason =
      'PayPal is waiting on seller evidence; the clock runs until it arrives.';
  } else if (allowed.includes('make_offer')) {
    suggestion = 'make_offer';
    reason = 'PayPal lists an offer as an option on this dispute.';
  } else if (allowed.includes('accept_claim') && allowed.length === 1) {
    suggestion = 'accept_claim';
    reason = 'Accepting the claim is the only action PayPal lists.';
  } else if (allowed.includes('wait_paypal')) {
    suggestion = 'wait_paypal';
    reason = 'The dispute is under PayPal review; nothing to send.';
  } else if (allowed.length > 0) {
    suggestion = allowed[0];
    reason = 'The next available action on this dispute.';
  }
  return { id: dispute.id, allowed, suggestion, reason };
}

/** Human dispute reason codes for cards and chat ("MERCHANDISE_OR_SERVICE_NOT_RECEIVED" → readable). */
export function humanDisputeReason(reason?: string): string {
  if (!reason) return 'unspecified reason';
  return reason
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
