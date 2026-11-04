import { createHash } from 'node:crypto';

export interface ActionHashInput {
  payeeName: string;
  payeePaypal: string;
  amount: string | number | { toString(): string };
  currency: string;
  purpose: string;
  idempotencyKey: string;
}

/**
 * Canonical money amount for hashing: always 2dp ("450" and "450.00" hash the
 * same), so the creation-time and execution-time computations agree no matter
 * which decimal form each side read.
 */
export function normalizeAmountForHash(
  amount: ActionHashInput['amount'],
): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`cannot hash invalid amount: ${String(amount)}`);
  }
  return n.toFixed(2);
}

/**
 * THE action hash — the only definition; creation and execution MUST both call
 * this. Covers payee name AND PayPal email (a post-approval email swap is
 * exactly the fraud case), amount, currency, purpose, and idempotency key.
 * This is the executable form of task.md's sha256(payee|amount|currency|
 * purpose|idempotencyKey), with the payee email made explicit.
 */
export function computeActionHash(input: ActionHashInput): string {
  const parts = [
    input.payeeName.trim(),
    input.payeePaypal.trim().toLowerCase(),
    normalizeAmountForHash(input.amount),
    input.currency.trim().toUpperCase(),
    input.purpose.trim(),
    input.idempotencyKey,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
