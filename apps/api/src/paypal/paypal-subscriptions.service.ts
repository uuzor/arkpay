import { Injectable } from '@nestjs/common';
import { PaypalApiError } from './paypal-api-error';
import { PaypalAuthService } from './paypal-auth.service';

/** First `details[].issue` from a PayPal error body, if present. */
function errorIssue(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { details?: Array<{ issue?: string }> };
    return body.details?.[0]?.issue;
  } catch {
    return undefined;
  }
}

export type SubscriptionStatus =
  | 'APPROVAL_PENDING'
  | 'APPROVED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface SubscriptionMoney {
  currency_code?: string;
  value?: string;
}

export interface SubscriptionSummary {
  id: string;
  status: string;
  planId?: string;
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

export interface SubscriptionDetails extends SubscriptionSummary {
  raw: unknown;
  /** HATEOAS rels present on the subscription (cancel, suspend, activate...). */
  links: string[];
}

export interface SubscriptionTransaction {
  id: string;
  status: string;
  time?: string;
  amount?: string;
  currency?: string;
  payerEmail?: string;
  payerName?: string;
}

function subscriberNameOf(subscriber: any): string | undefined {
  const name = subscriber?.name;
  if (!name) return undefined;
  if (typeof name === 'string') return name;
  return (
    [name.given_name, name.surname].filter(Boolean).join(' ') || undefined
  );
}

/**
 * PayPal Subscriptions v1, plain REST.
 *
 * Seller-side API: it manages subscriptions TO the workspace's own plans
 * (recurring client billing), not subscriptions the workspace pays for.
 * Only this module may touch PayPal credentials or APIs — nothing here is
 * ever exposed to the LLM.
 */
@Injectable()
export class PaypalSubscriptionsService {
  constructor(private readonly auth: PaypalAuthService) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    workspaceId: string,
    body?: unknown,
    tolerateIssues: string[] = [],
  ): Promise<T> {
    const { token, baseUrl } = await this.auth.context(workspaceId);
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // cancel/suspend/activate return 204 with an empty body.
    const text = await res.text();
    if (!res.ok) {
      if (
        tolerateIssues.length &&
        tolerateIssues.includes(errorIssue(text) ?? '')
      ) {
        return (text ? JSON.parse(text) : undefined) as T;
      }
      throw new PaypalApiError(
        res.status,
        `PayPal ${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 500)}`,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * GET /v1/billing/subscriptions — list the merchant's subscriptions.
   * `statuses` filters by status (ACTIVE, SUSPENDED, CANCELLED, ...).
   */
  async listSubscriptions(
    workspaceId: string,
    opts: { statuses?: SubscriptionStatus[]; pageSize?: number } = {},
  ): Promise<SubscriptionSummary[]> {
    const params = new URLSearchParams();
    if (opts.statuses?.length) params.set('statuses', opts.statuses.join(','));
    params.set('page_size', String(Math.min(Math.max(opts.pageSize ?? 20, 1), 50)));
    params.set('page', '1');
    const json = await this.request<{ subscriptions?: unknown[] }>(
      'GET',
      `/v1/billing/subscriptions?${params.toString()}`,
      workspaceId,
    );
    return (json.subscriptions ?? []).map((s) => this.mapSummary(s));
  }

  /**
   * GET /v1/billing/subscriptions/{id} — full details incl. billing_info
   * (last payment, next billing, failed count, outstanding balance).
   */
  async getSubscription(
    subscriptionId: string,
    workspaceId: string,
  ): Promise<SubscriptionDetails> {
    const json = await this.request<any>(
      'GET',
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
      workspaceId,
    );
    const links = Array.isArray(json?.links)
      ? json.links.map((l: any) => String(l?.rel ?? '')).filter(Boolean)
      : [];
    return { ...this.mapSummary(json), raw: json, links };
  }

  /**
   * GET /v1/billing/subscriptions/{id}/transactions — payment history for
   * one subscription. Both bounds are required ISO datetimes.
   */
  async listTransactions(
    subscriptionId: string,
    workspaceId: string,
    startTime: string,
    endTime: string,
  ): Promise<SubscriptionTransaction[]> {
    const params = new URLSearchParams({ start_time: startTime, end_time: endTime });
    const json = await this.request<{ transactions?: unknown[] }>(
      'GET',
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/transactions?${params.toString()}`,
      workspaceId,
    );
    return (json.transactions ?? []).map((t: any) => {
      const amount = t?.amount_with_breakdown?.gross_amount ?? t?.amount ?? {};
      return {
        id: String(t?.id ?? ''),
        status: String(t?.status ?? ''),
        time: t?.time ? String(t.time) : undefined,
        amount: amount?.value ? String(amount.value) : undefined,
        currency: amount?.currency_code ? String(amount.currency_code) : undefined,
        payerEmail: t?.payer_email ? String(t.payer_email) : undefined,
        payerName: t?.payer_name ? String(t.payer_name) : undefined,
      };
    });
  }

  /**
   * POST /v1/billing/subscriptions/{id}/cancel — body requires a reason.
   * Cancelling an already-cancelled subscription is idempotent success.
   */
  async cancelSubscription(
    subscriptionId: string,
    workspaceId: string,
    reason: string,
  ): Promise<void> {
    await this.request<void>(
      'POST',
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      workspaceId,
      { reason },
      ['SUBSCRIPTION_ALREADY_CANCELLED', 'SUBSCRIPTION_ALREADY_EXPIRED'],
    );
  }

  /** POST /v1/billing/subscriptions/{id}/suspend — reversible pause. */
  async suspendSubscription(
    subscriptionId: string,
    workspaceId: string,
    reason: string,
  ): Promise<void> {
    await this.request<void>(
      'POST',
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/suspend`,
      workspaceId,
      { reason },
      ['SUBSCRIPTION_ALREADY_SUSPENDED'],
    );
  }

  /** POST /v1/billing/subscriptions/{id}/activate — resume a suspension. */
  async activateSubscription(
    subscriptionId: string,
    workspaceId: string,
    reason: string,
  ): Promise<void> {
    await this.request<void>(
      'POST',
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/activate`,
      workspaceId,
      { reason },
      ['SUBSCRIPTION_ALREADY_ACTIVE'],
    );
  }

  /**
   * POST /v1/billing/subscriptions — fixture helper (and future recurring
   * billing). Returns the approval link the subscriber must open: a
   * subscription only becomes ACTIVE after buyer approval, which no API
   * can perform.
   */
  async createSubscription(
    workspaceId: string,
    input: {
      planId: string;
      subscriberEmail: string;
      subscriberName?: string;
      returnUrl?: string;
      cancelUrl?: string;
    },
  ): Promise<{ id: string; status: string; approveLink?: string }> {
    const [givenName, ...rest] = (input.subscriberName ?? '').split(' ');
    const json = await this.request<any>(
      'POST',
      '/v1/billing/subscriptions',
      workspaceId,
      {
        plan_id: input.planId,
        subscriber: {
          name: {
            given_name: givenName || 'Sandbox',
            surname: rest.join(' ') || 'Subscriber',
          },
          email_address: input.subscriberEmail,
        },
        application_context: {
          brand_name: 'ArkPay Sandbox',
          return_url: input.returnUrl ?? 'https://example.com/return',
          cancel_url: input.cancelUrl ?? 'https://example.com/cancel',
        },
      },
    );
    const approveLink = Array.isArray(json?.links)
      ? json.links.find((l: any) => l?.rel === 'approve')?.href
      : undefined;
    return {
      id: String(json?.id ?? ''),
      status: String(json?.status ?? ''),
      approveLink: approveLink ? String(approveLink) : undefined,
    };
  }

  /**
   * POST /v1/catalogs/products — fixture helper so sandbox demos can build
   * a product → plan → subscription chain without leaving the API.
   */
  async createProduct(
    workspaceId: string,
    input: { name: string; type?: 'SERVICE' | 'PHYSICAL' | 'DIGITAL' },
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'POST',
      '/v1/catalogs/products',
      workspaceId,
      { name: input.name, type: input.type ?? 'SERVICE' },
    );
  }

  /**
   * POST /v1/billing/plans — fixture helper. Creates a simple monthly plan;
   * the caller activates it before subscriptions can attach.
   */
  async createMonthlyPlan(
    workspaceId: string,
    input: { productId: string; name: string; amount: string; currency?: string },
  ): Promise<{ id: string; status: string }> {
    const currency = input.currency ?? 'USD';
    return this.request<{ id: string; status: string }>(
      'POST',
      '/v1/billing/plans',
      workspaceId,
      {
        product_id: input.productId,
        name: input.name,
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: { interval_unit: 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: { value: input.amount, currency_code: currency },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          payment_failure_threshold: 3,
        },
      },
    );
  }

  private mapSummary(s: any): SubscriptionSummary {
    const billing = s?.billing_info ?? {};
    const lastPayment = billing?.last_payment ?? {};
    const lastAmount = lastPayment?.amount ?? {};
    const outstanding = billing?.outstanding_balance ?? {};
    return {
      id: String(s?.id ?? ''),
      status: String(s?.status ?? ''),
      planId: s?.plan_id ? String(s.plan_id) : undefined,
      subscriberEmail: s?.subscriber?.email_address
        ? String(s.subscriber.email_address)
        : undefined,
      subscriberName: subscriberNameOf(s?.subscriber),
      lastPaymentAmount: lastAmount?.value ? String(lastAmount.value) : undefined,
      lastPaymentCurrency: lastAmount?.currency_code
        ? String(lastAmount.currency_code)
        : undefined,
      lastPaymentTime: lastPayment?.time ? String(lastPayment.time) : undefined,
      nextBillingTime: billing?.next_billing_time
        ? String(billing.next_billing_time)
        : undefined,
      failedPaymentsCount:
        typeof billing?.failed_payments_count === 'number'
          ? billing.failed_payments_count
          : undefined,
      outstandingBalance: outstanding?.value ? String(outstanding.value) : undefined,
      outstandingCurrency: outstanding?.currency_code
        ? String(outstanding.currency_code)
        : undefined,
    };
  }
}
