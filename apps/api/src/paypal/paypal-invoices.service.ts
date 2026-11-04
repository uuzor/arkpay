import { Injectable } from '@nestjs/common';
import { PaypalApiError } from './paypal-api-error';
import { PaypalAuthService } from './paypal-auth.service';

// Re-exported so existing importers keep working.
export { PaypalApiError };

/** Pull the invoice id out of a PayPal self href or Location header. */
function invoiceIdFromHref(href?: string): string | undefined {
  if (!href) return undefined;
  const match = /\/invoices\/([^/?#]+)/.exec(href);
  return match?.[1];
}

/** First `details[].issue` from a PayPal error body, if present. */
function errorIssue(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { details?: Array<{ issue?: string }> };
    return body.details?.[0]?.issue;
  } catch {
    return undefined;
  }
}

export interface InvoiceItemInput {
  name: string;
  quantity: number;
  /** Decimal string, e.g. "450.00". */
  unitAmount: string;
}

export interface CreateInvoiceInput {
  recipientEmail: string;
  currency?: string;
  items: InvoiceItemInput[];
  note?: string;
}

export interface PaypalInvoice {
  id: string;
  status: string;
  [key: string]: unknown;
}

/**
 * PayPal Invoicing v2, plain REST (create draft → send).
 * Only this module (and its siblings under paypal/) may touch PayPal
 * credentials or APIs — nothing here is ever exposed to the LLM.
 */
@Injectable()
export class PaypalInvoicesService {
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
    const text = await res.text(); // send returns 202 with an empty body
    if (!res.ok) {
      // Some "already done" outcomes are idempotent success for our state
      // machine, e.g. sending an already-sent invoice.
      if (tolerateIssues.length && tolerateIssues.includes(errorIssue(text) ?? '')) {
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
   * POST /v2/invoicing/invoices — body must include an items array.
   *
   * PayPal responds 201 with `{ rel: "self", href: ".../invoices/INV2-..." }`
   * (not an `id` field), so we derive the invoice id from the href. The
   * Location header carries the same id; the href is used because it is
   * already parsed and avoids an extra header round-trip.
   */
  async createDraftInvoice(
    input: CreateInvoiceInput,
    workspaceId: string,
  ): Promise<PaypalInvoice> {
    if (input.items.length === 0) {
      throw new Error('invoice needs at least one item');
    }
    const currency = input.currency ?? 'USD';
    const created = await this.request<{
      id?: string;
      href?: string;
      status?: string;
    }>('POST', '/v2/invoicing/invoices', workspaceId, {
      detail: {
        currency_code: currency,
        ...(input.note ? { note: input.note } : {}),
      },
      primary_recipients: [
        { billing_info: { email_address: input.recipientEmail } },
      ],
      items: input.items.map((it) => ({
        name: it.name,
        quantity: String(it.quantity),
        unit_amount: { currency_code: currency, value: it.unitAmount },
      })),
    });
    const id = created?.id ?? invoiceIdFromHref(created?.href);
    if (!id) {
      throw new Error(
        `PayPal created an invoice but returned no id: ${JSON.stringify(created)}`,
      );
    }
    return { ...created, id, status: created?.status ?? 'DRAFT' };
  }

  /**
   * POST /v2/invoicing/invoices/{id}/send — empty body is valid (all fields
   * optional). Resending an already-sent invoice returns HTTP 422 with
   * `details[].issue = INVOICE_ALREADY_SENT`; we treat that as idempotent
   * success so a retry never fails a flow that already sent the invoice.
   */
  async sendInvoice(invoiceId: string, workspaceId: string): Promise<void> {
    await this.request<void>(
      'POST',
      `/v2/invoicing/invoices/${invoiceId}/send`,
      workspaceId,
      {},
      ['INVOICE_ALREADY_SENT'],
    );
  }

  /**
   * POST /v2/invoicing/invoices/{id}/remind — send the recipient a payment
   * reminder. PayPal rejects reminders for paid invoices; the caller treats
   * that as a no-op.
   */
  async remindInvoice(
    invoiceId: string,
    workspaceId: string,
    note?: string,
  ): Promise<void> {
    await this.request<void>(
      'POST',
      `/v2/invoicing/invoices/${invoiceId}/remind`,
      workspaceId,
      note ? { note } : {},
      ['INVOICE_ALREADY_PAID'],
    );
  }

  /**
   * GET /v2/invoicing/invoices/{id} — read current status for resume and
   * reconcile paths, so a retry never creates a duplicate invoice.
   */
  async getInvoice(
    invoiceId: string,
    workspaceId: string,
  ): Promise<PaypalInvoice> {
    return this.request<PaypalInvoice>(
      'GET',
      `/v2/invoicing/invoices/${invoiceId}`,
      workspaceId,
    );
  }
}
