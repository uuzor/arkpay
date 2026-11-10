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

export type DisputeState =
  | 'REQUIRED_ACTION'
  | 'REQUIRED_OTHER_PARTY_ACTION'
  | 'UNDER_PAYPAL_REVIEW'
  | 'RESOLVED'
  | 'OPEN_INQUIRIES'
  | 'APPEALABLE';

export type OfferType =
  | 'REFUND'
  | 'REFUND_WITH_RETURN'
  | 'REFUND_WITH_REPLACEMENT'
  | 'REPLACEMENT_WITHOUT_REFUND';

export interface DisputeSummary {
  id: string;
  reason?: string;
  status?: string;
  state?: string;
  lifeCycleStage?: string;
  amount?: string;
  currency?: string;
  buyerName?: string;
  buyerEmail?: string;
  createTime?: string;
  updateTime?: string;
  transactionId?: string;
}

export interface DisputeDetails extends DisputeSummary {
  raw: unknown;
  /** HATEOAS rels: only listed actions are legal on this dispute now. */
  links: string[];
  messages: Array<{ postedBy: string; time?: string; content?: string }>;
  evidences: Array<{
    type?: string;
    source?: string;
    notes?: string;
    date?: string;
  }>;
  offerTypes?: string[];
  acceptClaimTypes?: string[];
}

export interface MakeOfferInput {
  note: string;
  offerType: OfferType;
  amount?: string;
  currency?: string;
  invoiceId?: string;
}

export interface EvidenceInput {
  evidenceType: string;
  notes?: string;
  trackingNumber?: string;
  carrierName?: string;
  refundId?: string;
}

/**
 * PayPal Customer Disputes v1, plain REST (seller side: disputes filed
 * AGAINST the workspace by its buyers).
 *
 * Stage rules come from PayPal's lifecycle, enforced here in code, not by
 * the model: messages only in INQUIRY, evidence only when the HATEOAS link
 * is present. Only this module may touch PayPal credentials or APIs —
 * nothing here is ever exposed to the LLM.
 */
@Injectable()
export class PaypalDisputesService {
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
   * GET /v1/customer/disputes — disputes against this account.
   * `state` filters (REQUIRED_ACTION, UNDER_PAYPAL_REVIEW, RESOLVED, ...).
   */
  async listDisputes(
    workspaceId: string,
    opts: { state?: DisputeState[]; pageSize?: number } = {},
  ): Promise<DisputeSummary[]> {
    const params = new URLSearchParams();
    if (opts.state?.length) params.set('dispute_state', opts.state.join(','));
    params.set('page_size', String(Math.min(Math.max(opts.pageSize ?? 20, 1), 50)));
    params.set('page', '1');
    const json = await this.request<{ items?: unknown[] }>(
      'GET',
      `/v1/customer/disputes?${params.toString()}`,
      workspaceId,
    );
    return (json.items ?? []).map((d) => this.mapSummary(d));
  }

  /** GET /v1/customer/disputes/{id} — full details + HATEOAS action links. */
  async getDispute(
    disputeId: string,
    workspaceId: string,
  ): Promise<DisputeDetails> {
    const json = await this.request<any>(
      'GET',
      `/v1/customer/disputes/${encodeURIComponent(disputeId)}`,
      workspaceId,
    );
    const links = Array.isArray(json?.links)
      ? json.links.map((l: any) => String(l?.rel ?? '')).filter(Boolean)
      : [];
    const messages = Array.isArray(json?.messages)
      ? json.messages.map((m: any) => ({
          postedBy: String(m?.posted_by ?? ''),
          time: m?.time ? String(m.time) : undefined,
          content: m?.content ? String(m.content) : undefined,
        }))
      : [];
    const evidences = Array.isArray(json?.evidences)
      ? json.evidences.map((e: any) => ({
          type: e?.evidence_type ? String(e.evidence_type) : undefined,
          source: e?.source ? String(e.source) : undefined,
          notes: e?.notes ? String(e.notes) : undefined,
          date: e?.date ? String(e.date) : undefined,
        }))
      : [];
    const allowed = json?.allowed_response_options ?? {};
    return {
      ...this.mapSummary(json),
      raw: json,
      links,
      messages,
      evidences,
      offerTypes: Array.isArray(allowed?.make_offer?.offer_types)
        ? allowed.make_offer.offer_types.map(String)
        : undefined,
      acceptClaimTypes: Array.isArray(allowed?.accept_claim?.accept_claim_types)
        ? allowed.accept_claim.accept_claim_types.map(String)
        : undefined,
    };
  }

  /**
   * POST /v1/customer/disputes/{id}/send-message — JSON {message}.
   * Only legal in the INQUIRY stage; the HATEOAS link is the source of
   * truth, so callers pass the links from a fresh getDispute.
   */
  async sendMessage(
    disputeId: string,
    workspaceId: string,
    message: string,
    links?: string[],
  ): Promise<void> {
    this.requireLink(links, 'send-message', disputeId, 'message');
    await this.request<void>(
      'POST',
      `/v1/customer/disputes/${encodeURIComponent(disputeId)}/send-message`,
      workspaceId,
      { message },
    );
  }

  /**
   * POST /v1/customer/disputes/{id}/make-offer — refund/replacement offer.
   * Money moves if the buyer accepts, so this is approval-gated upstream.
   */
  async makeOffer(
    disputeId: string,
    workspaceId: string,
    input: MakeOfferInput,
    links?: string[],
  ): Promise<void> {
    this.requireLink(links, 'make-offer', disputeId, 'offer');
    await this.request<void>(
      'POST',
      `/v1/customer/disputes/${encodeURIComponent(disputeId)}/make-offer`,
      workspaceId,
      {
        note: input.note,
        offer_type: input.offerType,
        ...(input.amount && input.currency
          ? {
              offer_amount: {
                value: input.amount,
                currency_code: input.currency,
              },
            }
          : {}),
        ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
      },
    );
  }

  /**
   * POST /v1/customer/disputes/{id}/provide-evidence — multipart with an
   * `input` JSON part (notes/tracking/refund, no file needed) per PayPal's
   * integration guide. Only when the HATEOAS link is present.
   */
  async provideEvidence(
    disputeId: string,
    workspaceId: string,
    input: EvidenceInput,
    links?: string[],
  ): Promise<void> {
    this.requireLink(links, 'provide-evidence', disputeId, 'evidence');
    const evidence: Record<string, unknown> = {
      evidence_type: input.evidenceType,
    };
    if (input.trackingNumber || input.refundId) {
      evidence.evidence_info = {
        ...(input.trackingNumber
          ? {
              tracking_info: [
                {
                  carrier_name: input.carrierName ?? 'OTHER',
                  tracking_number: input.trackingNumber,
                },
              ],
            }
          : {}),
        ...(input.refundId ? { refund_ids: [input.refundId] } : {}),
      };
    }
    if (input.notes) evidence.notes = input.notes;
    const form = new FormData();
    form.append(
      'input',
      new Blob([JSON.stringify({ evidences: [evidence] })], {
        type: 'application/json',
      }),
    );
    const { token, baseUrl } = await this.auth.context(workspaceId);
    const res = await fetch(
      `${baseUrl}/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new PaypalApiError(
        res.status,
        `PayPal POST provide-evidence failed: HTTP ${res.status} ${text.slice(0, 500)}`,
      );
    }
  }

  /**
   * POST /v1/customer/disputes/{id}/accept-claim — accepts liability; PayPal
   * refunds the buyer and closes the dispute. JSON {note}.
   */
  async acceptClaim(
    disputeId: string,
    workspaceId: string,
    note: string,
    links?: string[],
  ): Promise<void> {
    this.requireLink(links, 'accept-claim', disputeId, 'accept-claim');
    await this.request<void>(
      'POST',
      `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`,
      workspaceId,
      { note },
    );
  }

  /**
   * HATEOAS gating: PayPal only lists the actions that are legal right now
   * (stage + status + reason). Acting without the link is a guaranteed 422,
   * so refuse in code with a readable error instead.
   */
  private requireLink(
    links: string[] | undefined,
    rel: string,
    disputeId: string,
    what: string,
  ): void {
    if (links && !links.includes(rel)) {
      throw new Error(
        `PayPal does not allow ${what} on dispute ${disputeId} right now (no ${rel} link)`,
      );
    }
  }

  private mapSummary(d: any): DisputeSummary {
    const txns = Array.isArray(d?.disputed_transactions)
      ? d.disputed_transactions
      : [];
    const first = txns[0] ?? {};
    const amount = first?.gross_amount ?? first?.amount ?? {};
    const buyer = first?.buyer ?? d?.buyer ?? {};
    const buyerName =
      [buyer?.name?.given_name, buyer?.name?.surname]
        .filter(Boolean)
        .join(' ') || undefined;
    const buyerEmail =
      buyer?.email_address ?? buyer?.email ?? d?.buyer_email ?? undefined;
    return {
      id: String(d?.dispute_id ?? ''),
      reason: d?.reason ? String(d.reason) : undefined,
      status: d?.status ? String(d.status) : undefined,
      state: d?.dispute_state ? String(d.dispute_state) : undefined,
      lifeCycleStage: d?.dispute_life_cycle_stage
        ? String(d.dispute_life_cycle_stage)
        : undefined,
      amount: amount?.value ? String(amount.value) : undefined,
      currency: amount?.currency_code ? String(amount.currency_code) : undefined,
      buyerName,
      buyerEmail: buyerEmail ? String(buyerEmail) : undefined,
      createTime: d?.create_time ? String(d.create_time) : undefined,
      updateTime: d?.update_time ? String(d.update_time) : undefined,
      transactionId: first?.seller_transaction_id
        ? String(first.seller_transaction_id)
        : undefined,
    };
  }
}
