import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionStatus, Prisma } from '@prisma/client';
import { AgentService } from '../../agent/agent.service';
import { ApprovalsService } from '../../approvals/approvals.service';
import { AuditService } from '../../audit/audit.service';
import { ContactsService } from '../../contacts/contacts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramService } from '../../telegram/telegram.service';
import { PaypalApiError } from '../paypal-api-error';
import { PaypalAuthService } from '../paypal-auth.service';

/**
 * Explicit subscription list (PayPal takes names, not wildcards). Covers the
 * invoice lifecycle we notify on plus payout batch/item outcomes.
 */
export const WEBHOOK_EVENT_TYPES = [
  // NOTE: INVOICING.INVOICE.VIEWED and .PARTIALLY_PAID look plausible but
  // PayPal rejects them as unknown event names (verified live 2026-11-03).
  // The handler still routes any INVOICING.INVOICE.* leaf generically.
  'INVOICING.INVOICE.SENT',
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.CANCELLED',
  'INVOICING.INVOICE.REFUNDED',
  'PAYMENT.PAYOUTSBATCH.SUCCESS',
  'PAYMENT.PAYOUTSBATCH.PROCESSING',
  'PAYMENT.PAYOUTSBATCH.DENIED',
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
  'PAYMENT.PAYOUTS-ITEM.FAILED',
  'PAYMENT.PAYOUTS-ITEM.DENIED',
  'PAYMENT.PAYOUTS-ITEM.BLOCKED',
  'PAYMENT.PAYOUTS-ITEM.UNCLAIMED',
  'PAYMENT.PAYOUTS-ITEM.RETURNED',
  'PAYMENT.PAYOUTS-ITEM.REFUNDED',
  'PAYMENT.PAYOUTS-ITEM.HELD',
  'PAYMENT.PAYOUTS-ITEM.CANCELED',
];

export type WebhookOutcome =
  | 'processed'
  | 'duplicate'
  | 'ignored'
  | 'unverified'
  | 'not_configured';

interface PaypalEvent {
  id?: string;
  event_type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resource?: any;
}

/**
 * PayPal → us. Order is fixed: ATTRIBUTE the tenant from the (unverified)
 * resource, VERIFY the signature with that tenant's credentials (forgeries
 * die here), then DEDUPE on the PayPal event id (retries die here), then
 * ROUTE. Everything after commit answers 200; notifications are best-effort
 * so a Telegram blip never turns into a PayPal retry storm.
 */
@Injectable()
export class PaypalWebhooksService {
  private readonly logger = new Logger(PaypalWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: PaypalAuthService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly contacts: ContactsService,
    private readonly telegram: TelegramService,
    private readonly agent: AgentService,
  ) {}

  async handle(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<{ outcome: WebhookOutcome; detail?: string }> {
    const event = (body ?? {}) as PaypalEvent;
    if (
      typeof event.id !== 'string' ||
      typeof event.event_type !== 'string'
    ) {
      return { outcome: 'unverified', detail: 'malformed event' };
    }
    // Attribute BEFORE verifying: the event arrives on the tenant's own
    // webhook subscription, so its credentials verify its signature. The
    // parse is local only — nothing from it is trusted until verify passes.
    // Unattributed events cannot be verified (no shared app) and are
    // rejected: PayPal retries, forgeries die.
    const tenantId = await this.preAttributeTenant(
      event.event_type,
      event.resource,
    );
    if (!tenantId) {
      this.logger.warn(`webhook ${event.id} rejected: unknown tenant`);
      return { outcome: 'unverified', detail: 'unknown tenant' };
    }
    const ws = await this.prisma.workspace.findUnique({
      where: { id: tenantId },
      select: { paypalWebhookId: true },
    });
    const webhookId =
      ws?.paypalWebhookId ??
      this.config.get<string>('PAYPAL_WEBHOOK_ID')?.trim();
    if (!webhookId) {
      this.logger.error(
        `no webhook id for workspace ${tenantId} and PAYPAL_WEBHOOK_ID is not set — cannot verify webhooks`,
      );
      return { outcome: 'not_configured' };
    }
    const one = (v: string | string[] | undefined) =>
      Array.isArray(v) ? v[0] : v;
    const verified = await this.verify(
      {
        auth_algo: one(headers['paypal-auth-algo']),
        cert_url: one(headers['paypal-cert-url']),
        transmission_id: one(headers['paypal-transmission-id']),
        transmission_sig: one(headers['paypal-transmission-sig']),
        transmission_time: one(headers['paypal-transmission-time']),
        webhook_id: webhookId,
        webhook_event: event,
      },
      tenantId,
    );
    if (!verified) {
      this.logger.warn(`webhook ${event.id} rejected: bad signature`);
      return { outcome: 'unverified', detail: 'bad signature' };
    }
    try {
      await this.prisma.processedWebhook.create({
        data: { eventId: event.id, type: event.event_type },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return { outcome: 'duplicate' };
      }
      throw e;
    }
    const routed = await this.route(
      event.id,
      event.event_type,
      event.resource ?? {},
    );
    return routed ? { outcome: 'processed' } : { outcome: 'ignored' };
  }

  /**
   * Best-effort tenant from the unverified resource: the invoice/batch id
   * points at the action that executed it. Null when the event references
   * nothing we track — verify then falls back to the shared env app.
   */
  private async preAttributeTenant(
    eventType: string,
    resource: any,
  ): Promise<string | null> {
    let ref: string | undefined;
    if (eventType.startsWith('INVOICING.INVOICE.')) {
      const invoice = resource?.invoice ?? resource ?? {};
      ref = invoice.id ?? invoice.invoice_id;
    } else if (eventType.startsWith('PAYMENT.PAYOUTSBATCH.')) {
      ref = resource?.batch_header?.payout_batch_id;
    } else if (eventType.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
      ref = resource?.payout_batch_id;
    }
    if (!ref) return null;
    const action = await this.prisma.action.findFirst({
      where: { paypalRef: String(ref) },
      select: { workspaceId: true },
    });
    return action?.workspaceId ?? null;
  }

  private async verify(
    payload: {
      auth_algo?: string;
      cert_url?: string;
      transmission_id?: string;
      transmission_sig?: string;
      transmission_time?: string;
      webhook_id: string;
      webhook_event: PaypalEvent;
    },
    workspaceId: string,
  ): Promise<boolean> {
    if (
      !payload.auth_algo ||
      !payload.cert_url ||
      !payload.transmission_id ||
      !payload.transmission_sig ||
      !payload.transmission_time
    ) {
      return false;
    }
    try {
      const { token, baseUrl } = await this.auth.context(workspaceId);
      const res = await fetch(
        `${baseUrl}/v1/notifications/verify-webhook-signature`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(`verify call failed: HTTP ${res.status}`);
        return false;
      }
      const json = JSON.parse(text) as { verification_status?: string };
      return json.verification_status === 'SUCCESS';
    } catch (e) {
      this.logger.warn(
        `verify call crashed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  /** Returns false for event types we deliberately don't route. */
  private async route(
    eventId: string,
    eventType: string,
    resource: any,
  ): Promise<boolean> {
    let attributed: string | null = null;
    if (eventType.startsWith('INVOICING.INVOICE.')) {
      attributed = await this.handleInvoiceEvent(eventType, resource);
    } else if (eventType.startsWith('PAYMENT.PAYOUTSBATCH.')) {
      attributed = await this.handlePayoutBatchEvent(eventType, resource);
    } else if (eventType.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
      attributed = await this.handlePayoutItemEvent(eventType, resource);
    } else {
      this.logger.log(`ignoring webhook type ${eventType}`);
      return false;
    }
    // Attribute the dedupe row to the matched tenant (10c routes on this).
    if (attributed) {
      await this.prisma.processedWebhook.updateMany({
        where: { eventId },
        data: { workspaceId: attributed },
      });
    }
    return true;
  }

  private async handleInvoiceEvent(
    eventType: string,
    resource: any,
  ): Promise<string | null> {
    // Live shape (verified 2026-11-03): the invoice nests under
    // resource.invoice — resource.id does NOT exist on these events.
    const invoice = resource?.invoice ?? resource ?? {};
    const invoiceId: string | undefined = invoice.id ?? invoice.invoice_id;
    if (!invoiceId) {
      this.logger.warn(
        `invoice webhook without id: ${eventType} (resource keys: ${Object.keys(resource ?? {}).join(',')})`,
      );
      return null;
    }
    const leaf = eventType.split('.').pop() as string;
    const actions = await this.prisma.action.findMany({
      where: { paypalRef: String(invoiceId) },
    });
    if (actions.length === 0) {
      this.logger.warn(`no action for invoice ${invoiceId} (${eventType})`);
      return null;
    }
    const amount =
      invoice.total_amount?.value ??
      resource?.amount?.value ??
      resource?.total_amount?.value ??
      null;
    const currency =
      invoice.total_amount?.currency_code ??
      invoice.detail?.currency_code ??
      resource?.amount?.currency_code ??
      resource?.detail?.currency_code ??
      null;
    for (const action of actions) {
      // Forward-only: a PAID arriving while we still show EXECUTING means the
      // webhook beat our own EXECUTED write — adopt it, never move backward.
      if (
        (leaf === 'PAID' || leaf === 'PARTIALLY_PAID') &&
        action.status === ActionStatus.EXECUTING
      ) {
        await this.prisma.$transaction(async (tx) => {
          await tx.action.updateMany({
            where: { id: action.id, status: ActionStatus.EXECUTING },
            data: { status: ActionStatus.EXECUTED },
          });
          await this.audit.log(
            action.id,
            `WEBHOOK_${leaf}`,
            { paypalRef: String(invoiceId), amount, currency },
            tx,
          );
        });
      } else {
        await this.audit.log(action.id, `WEBHOOK_${leaf}`, {
          paypalRef: String(invoiceId),
          amount,
          currency,
        });
      }
      if (leaf === 'PAID' || leaf === 'PARTIALLY_PAID') {
        // An invoice is truly paid now: learn the client (best-effort).
        if (action.contactId) {
          try {
            await this.contacts.recordPayment(
              action.contactId,
              Number(amount ?? action.amount),
              (currency as string) ?? action.currency,
              action.workspaceId,
            );
          } catch (e) {
            this.logger.warn(
              `invoice learning skipped for ${action.id}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        const contact = await this.contactName(action.contactId);
        const money =
          amount && currency ? ` (${currency} ${amount})` : '';
        this.analyzeAndNotify(
          `PayPal event ${eventType}. Invoice ${invoiceId} was ${leaf === 'PAID' ? 'paid in full' : 'partially paid'}${money}. ArkPay action ${action.id} is ${action.status}; contact: ${contact ?? 'unknown'}.`,
          `💰 Invoice ${invoiceId} ${leaf === 'PAID' ? 'paid' : 'partially paid'}${money}`,
          action.workspaceId,
        );
      } else if (leaf === 'CANCELLED' || leaf === 'REFUNDED') {
        const contact = await this.contactName(action.contactId);
        this.analyzeAndNotify(
          `PayPal event ${eventType}. Invoice ${invoiceId} was ${leaf.toLowerCase()}${amount && currency ? ` (${currency} ${amount})` : ''}. ArkPay action ${action.id} is ${action.status}; contact: ${contact ?? 'unknown'}.`,
          `⚠️ Invoice ${invoiceId} ${leaf.toLowerCase()} — no action needed`,
          action.workspaceId,
        );
      }
      // SENT/VIEWED/others: audit trail only, no ping.
    }
    return actions[0]?.workspaceId ?? null;
  }

  private async handlePayoutBatchEvent(
    eventType: string,
    resource: any,
  ): Promise<string | null> {
    const batchId: string | undefined =
      resource?.batch_header?.payout_batch_id;
    if (!batchId) {
      this.logger.warn(`payout batch webhook without id: ${eventType}`);
      return null;
    }
    const leaf = eventType.split('.').pop() as string;
    const rows = await this.prisma.action.findMany({
      where: { paypalRef: String(batchId) },
      select: { id: true, workspaceId: true },
    });
    const { settled } = await this.approvals.syncPayoutBatch(String(batchId));
    for (const row of rows) {
      await this.audit.log(row.id, `WEBHOOK_PAYOUT_${leaf}`, {
        paypalRef: String(batchId),
      });
    }
    // Our own execute path already receipts what it settles; the webhook
    // pings only when IT moved rows (the race case) — never a "0 paid" ping.
    const moved = settled.executed + settled.failed;
    if (rows.length > 0 && moved > 0 && leaf === 'SUCCESS') {
      this.analyzeAndNotify(
        `PayPal event ${eventType}. Payout batch ${batchId} succeeded: ${settled.executed} paid${settled.failed > 0 ? `, ${settled.failed} failed` : ''} across ${rows.length} ArkPay action(s).`,
        `✅ Payout batch ${batchId}: ${settled.executed} paid` +
          (settled.failed > 0 ? `, ${settled.failed} failed` : ''),
        rows[0]?.workspaceId,
      );
    } else if (rows.length > 0 && moved > 0 && leaf === 'DENIED') {
      this.analyzeAndNotify(
        `PayPal event ${eventType}. Payout batch ${batchId} was denied; ${settled.failed} ArkPay action(s) marked failed.`,
        `⛔ Payout batch ${batchId} denied`,
        rows[0]?.workspaceId,
      );
    } else if (rows.length === 0) {
      this.logger.warn(`no actions for payout batch ${batchId}`);
    }
    return rows[0]?.workspaceId ?? null;
  }

  private async handlePayoutItemEvent(
    eventType: string,
    resource: any,
  ): Promise<string | null> {
    const batchId: string | undefined = resource?.payout_batch_id;
    if (!batchId) {
      this.logger.warn(`payout item webhook without batch id: ${eventType}`);
      return null;
    }
    await this.approvals.syncPayoutBatch(String(batchId));
    const leaf = eventType.split('.').pop() as string;
    const member = await this.findMemberWorkspace(String(batchId));
    // Unattributed failures stay audit-only: no tenant, no route, no ping.
    if (member?.workspaceId && ['FAILED', 'DENIED', 'BLOCKED'].includes(leaf)) {
      const receiver: string =
        resource?.payout_item?.receiver ?? 'a recipient';
      const amount = resource?.payout_item?.amount;
      const money = amount ? ` (${amount.currency} ${amount.value})` : '';
      this.analyzeAndNotify(
        `PayPal event ${eventType}. A payout to ${receiver}${money} ${leaf.toLowerCase()} (batch ${batchId}). Suggest what to check or do next.`,
        `⚠️ Payout to ${receiver} ${leaf.toLowerCase()}${money}`,
        member.workspaceId,
      );
    }
    // SUCCEEDED/UNCLAIMED/etc: the batch summary covers them.
    return member?.workspaceId ?? null;
  }

  /**
   * Owning tenant of one PayPal payout batch. Matches OUR PayPal reference,
   * not our internal batch id: PayPal's `payout_batch_id` is its own id
   * (ours went out as `sender_batch_id` and is unrecoverable inbound).
   */
  private async findMemberWorkspace(
    payoutBatchId: string,
  ): Promise<{ workspaceId: string } | null> {
    return this.prisma.action.findFirst({
      where: { paypalRef: payoutBatchId },
      select: { workspaceId: true },
    });
  }

  private async notify(text: string, workspaceId: string): Promise<void> {
    try {
      await this.telegram.sendMessage(text, workspaceId);
    } catch (e) {
      this.logger.warn(
        `webhook notify failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Agent-first notification. Fire-and-forget by design — callers MUST NOT
   * await it, so the webhook answers 200 fast. Falls back to the fixed ping
   * if analysis fails, so a notification is guaranteed either way.
   */
  private analyzeAndNotify(
    brief: string,
    fallback: string,
    workspaceId: string,
  ): void {
    void (async () => {
      try {
        const text = await this.agent.analyzeEvent(brief, workspaceId);
        await this.telegram.sendMessage(`🔔 ${text}`, workspaceId);
      } catch (e) {
        this.logger.warn(
          `webhook agent analysis failed, using fallback ping: ${e instanceof Error ? e.message : String(e)}`,
        );
        await this.notify(fallback, workspaceId);
      }
    })();
  }

  private async contactName(contactId: string | null): Promise<string | null> {
    if (!contactId) return null;
    const c = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { name: true },
    });
    return c?.name ?? null;
  }

  /** Setup helpers (not the event path): list/create PayPal webhooks. */
  async listWebhooks(workspaceId: string): Promise<unknown> {
    const { token, baseUrl } = await this.auth.context(workspaceId);
    const res = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new PaypalApiError(
        res.status,
        `PayPal list webhooks failed: HTTP ${res.status} ${text.slice(0, 400)}`,
      );
    }
    return JSON.parse(text);
  }

  /**
   * Subscribe the workspace's PayPal app and remember the subscription id —
   * verification looks it up per event tenant.
   */
  async createWebhook(
    url: string,
    workspaceId: string,
  ): Promise<{ id: string; url: string }> {
    if (!url.startsWith('https://')) {
      throw new Error('webhook url must be https');
    }
    const { token, baseUrl } = await this.auth.context(workspaceId);
    const res = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })),
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new PaypalApiError(
        res.status,
        `PayPal create webhook failed: HTTP ${res.status} ${text.slice(0, 500)}`,
      );
    }
    const json = JSON.parse(text) as { id: string; url: string };
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { paypalWebhookId: json.id },
    });
    return { id: json.id, url: json.url };
  }
}
