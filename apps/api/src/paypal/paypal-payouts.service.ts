import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PaypalApiError } from './paypal-api-error';
import { PaypalAuthService } from './paypal-auth.service';

/**
 * Deterministic PayPal-safe batch id. Our idempotency keys are UUIDs (36
 * chars); PayPal's sender fields are short strings, so we send a sha256
 * prefix instead — stable across retries, collision-negligible, and it keeps
 * the Key Decision 2 promise (one key derives the PayPal id) without ever
 * risking a field-length rejection.
 */
export function toPaypalBatchId(key: string): string {
  return createHash('sha256').update(`batch:${key}`).digest('hex').slice(0, 30);
}

/** Same treatment per payout item, derived from the member's unique key. */
export function toPaypalItemId(key: string): string {
  return createHash('sha256').update(`item:${key}`).digest('hex').slice(0, 30);
}

/** Pull a payout_batch_id out of PayPal's duplicate-batch HATEOAS link. */
function batchIdFromError(text: string): string | null {
  const match = /\/v1\/payments\/payouts\/([A-Z0-9]+)/.exec(text);
  return match?.[1] ?? null;
}

export interface PayoutItemInput {
  receiver: string;
  amount: string;
  currency: string;
  note?: string;
  senderItemId: string;
}

export interface CreatePayoutBatchInput {
  /** Our idempotency key; derived into sender_batch_id (30-day PayPal window). */
  senderBatchId: string;
  /** Sent as PayPal-Request-Id; same key must be reused on retry. */
  requestId: string;
  emailSubject?: string;
  items: PayoutItemInput[];
}

export interface PayoutBatchItem {
  payoutItemId: string;
  transactionId?: string;
  transactionStatus: string;
  senderItemId?: string;
  receiver?: string;
  errors?: unknown;
}

export interface PayoutBatch {
  payoutBatchId: string;
  batchStatus: string;
  items: PayoutBatchItem[];
}

/**
 * PayPal Payouts, plain REST (create batch → poll status).
 * Same credential boundary as invoices: only paypal/ touches PayPal creds.
 */
@Injectable()
export class PaypalPayoutsService {
  private readonly logger = new Logger(PaypalPayoutsService.name);

  constructor(private readonly auth: PaypalAuthService) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    workspaceId: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const { token, baseUrl } = await this.auth.context(workspaceId);
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new PaypalApiError(
        res.status,
        `PayPal ${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 800)}`,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * POST /v1/payments/payouts — always resolves to the live batch state.
   *
   * Duplicate-sender_batch_id behavior (verified in the Payouts reference):
   * PayPal REJECTS the re-POST with an error linking the original batch
   * (30-day window) instead of returning it. We adopt that link and GET the
   * original, so a lost-create-response retries into the same batch instead
   * of failing or double-paying. A 400 WITHOUT such a link is a real
   * validation error and rethrows.
   */
  async createPayoutBatch(
    input: CreatePayoutBatchInput,
    workspaceId: string,
  ): Promise<PayoutBatch> {
    if (input.items.length === 0) {
      throw new Error('payout needs at least one item');
    }
    const body = {
      sender_batch_header: {
        sender_batch_id: toPaypalBatchId(input.senderBatchId),
        email_subject: input.emailSubject ?? 'You have a payout',
      },
      items: input.items.map((it) => ({
        recipient_type: 'EMAIL',
        receiver: it.receiver,
        note: (it.note ?? '').slice(0, 500),
        sender_item_id: it.senderItemId,
        amount: { currency: it.currency, value: it.amount },
      })),
    };
    try {
      const created = await this.request<{
        batch_header: { payout_batch_id: string; batch_status: string };
      }>(
        'POST',
        '/v1/payments/payouts',
        workspaceId,
        body,
        {
          'PayPal-Request-Id': input.requestId,
        },
      );
      return {
        payoutBatchId: created.batch_header.payout_batch_id,
        batchStatus: created.batch_header.batch_status,
        items: [],
      };
    } catch (e) {
      if (e instanceof PaypalApiError && e.status === 400) {
        const adopted = batchIdFromError(e.message);
        if (adopted) {
          this.logger.warn(
            `duplicate sender_batch_id adopted original batch ${adopted}`,
          );
          return this.getPayoutBatch(adopted, workspaceId);
        }
      }
      throw e;
    }
  }

  /** GET /v1/payments/payouts/{payout_batch_id} — batch + per-item state. */
  async getPayoutBatch(
    payoutBatchId: string,
    workspaceId: string,
  ): Promise<PayoutBatch> {
    const res = await this.request<{
      batch_header: { payout_batch_id: string; batch_status: string };
      items?: Array<{
        payout_item_id: string;
        transaction_id?: string;
        transaction_status?: string;
        payout_item?: {
          sender_item_id?: string;
          receiver?: string;
        };
        errors?: unknown;
      }>;
    }>('GET', `/v1/payments/payouts/${payoutBatchId}`, workspaceId);
    return {
      payoutBatchId: res.batch_header.payout_batch_id,
      batchStatus: res.batch_header.batch_status,
      items: (res.items ?? []).map((it) => ({
        payoutItemId: it.payout_item_id,
        transactionId: it.transaction_id,
        transactionStatus: it.transaction_status ?? 'UNKNOWN',
        senderItemId: it.payout_item?.sender_item_id,
        receiver: it.payout_item?.receiver,
        errors: it.errors,
      })),
    };
  }

  /**
   * Poll a batch until terminal (SUCCESS/DENIED/CANCELED) or the budget runs
   * out. Sandbox settles in seconds; callers leave the row EXECUTING on
   * timeout and let the reaper continue (never mark blind).
   */
  async waitForTerminalBatch(
    payoutBatchId: string,
    tries = 12,
    intervalMs = 5000,
    workspaceId: string,
  ): Promise<PayoutBatch> {
    let batch = await this.getPayoutBatch(payoutBatchId, workspaceId);
    for (let i = 0; i < tries; i += 1) {
      const status = batch.batchStatus.toUpperCase();
      if (status !== 'PENDING' && status !== 'PROCESSING') return batch;
      await new Promise((r) => setTimeout(r, intervalMs));
      batch = await this.getPayoutBatch(payoutBatchId, workspaceId);
    }
    return batch;
  }
}
