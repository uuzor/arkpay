import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionStatus,
  ActionType,
  ContactKind,
  type Contact,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { computeActionHash } from '../approvals/action-hash';
import { AuditService } from '../audit/audit.service';
import { ContactsService } from '../contacts/contacts.service';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
import { TelegramService } from './telegram.service';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;

export interface DraftInput {
  payeeName?: string;
  payeeEmail?: string;
  amount?: string | number;
  currency?: string;
  purpose?: string;
  contactKind?: ContactKind;
  /** Free text the draft came from (chat instruction); feeds injection signals. */
  sourceText?: string | null;
  /** Client key for idempotent creates (dashboard double-submit). */
  idempotencyKey?: string;
  /**
   * Known PayPal id (subscription / dispute) when it exists before approval
   * — unlike invoices, where PayPal assigns it at execution. Lets webhooks
   * and resume paths match the action immediately.
   */
  paypalRef?: string;
  /** Extra structured payload merged into extractedJson (ids, op fields). */
  extracted?: Record<string, unknown>;
}

export interface DraftResult {
  ok: boolean;
  blocked: boolean;
  duplicate: boolean;
  actionId: string;
  cardSent: boolean;
  summary: string;
  flags: string[];
  policyVersion: string;
}

/**
 * The ONE validated-creation path for invoices and single payouts: the
 * agent tools and the dashboard REST endpoints both land here, so Gate 1,
 * persistence, audit, and card dispatch cannot drift between surfaces.
 * Conversational slot-filling stays in the agent; HTTP validation errors
 * throw 400s instead of the chatty needs[] flow.
 */
@Injectable()
export class DraftService {
  private readonly logger = new Logger(DraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly contacts: ContactsService,
    private readonly safety: SafetyService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramService,
  ) {}

  async createInvoice(
    input: DraftInput,
    opts: { workspaceId: string; via: string; by: string },
  ): Promise<DraftResult> {
    return this.create(ActionType.INVOICE, ContactKind.CLIENT, input, opts);
  }

  async createPayout(
    input: DraftInput,
    opts: { workspaceId: string; via: string; by: string },
  ): Promise<DraftResult> {
    return this.create(
      ActionType.PAYOUT_SINGLE,
      input.contactKind ?? ContactKind.SUPPLIER,
      input,
      opts,
    );
  }

  async createSubscriptionAction(
    op: 'cancel' | 'suspend' | 'activate',
    input: DraftInput,
    opts: { workspaceId: string; via: string; by: string },
  ): Promise<DraftResult> {
    const type =
      op === 'cancel'
        ? ActionType.SUBSCRIPTION_CANCEL
        : op === 'suspend'
          ? ActionType.SUBSCRIPTION_SUSPEND
          : ActionType.SUBSCRIPTION_ACTIVATE;
    return this.create(type, ContactKind.CLIENT, input, opts);
  }

  async createDisputeAction(
    op: 'message' | 'offer' | 'evidence' | 'accept',
    input: DraftInput,
    opts: { workspaceId: string; via: string; by: string },
  ): Promise<DraftResult> {
    const type =
      op === 'message'
        ? ActionType.DISPUTE_MESSAGE
        : op === 'offer'
          ? ActionType.DISPUTE_OFFER
          : op === 'evidence'
            ? ActionType.DISPUTE_EVIDENCE
            : ActionType.DISPUTE_ACCEPT_CLAIM;
    return this.create(type, ContactKind.CLIENT, input, opts);
  }

  private async create(
    type: ActionType,
    contactKind: ContactKind,
    input: DraftInput,
    opts: { workspaceId: string; via: string; by: string },
  ): Promise<DraftResult> {
    const payeeName = (input.payeeName ?? '').trim();
    const payeeEmail = (input.payeeEmail ?? '').trim();
    const amount =
      typeof input.amount === 'number' ? String(input.amount) : (
        (input.amount ?? '').trim()
      );
    const currency = (input.currency ?? '').trim().toUpperCase();
    const purpose = (input.purpose ?? '').trim();
    if (!payeeName) throw new BadRequestException('payeeName is required');
    if (!EMAIL_RE.test(payeeEmail)) {
      throw new BadRequestException('payeeEmail is not a valid email');
    }
    if (!AMOUNT_RE.test(amount)) {
      throw new BadRequestException(
        'amount must be a positive number with up to 2 decimals',
      );
    }
    if (!CURRENCY_RE.test(currency)) {
      throw new BadRequestException('currency must be a 3-letter code');
    }
    if (!purpose) throw new BadRequestException('purpose is required');

    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = await this.prisma.action.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.workspaceId !== opts.workspaceId) {
        // The key is global; another tenant owns it. Refuse rather than
        // leak their action id (their detail route would 404 anyway).
        throw new ConflictException('idempotency key already in use');
      }
      const blocked = existing.status === ActionStatus.BLOCKED;
      return {
        ok: !blocked,
        blocked,
        duplicate: true,
        actionId: existing.id,
        cardSent: false,
        summary: existing.safetySummary ?? '',
        flags: existing.riskFlags,
        policyVersion: existing.policyVersion ?? '',
      };
    }

    const contact: Contact | null = await this.contacts.findOrCreate(
      { name: payeeName, paypalEmail: payeeEmail, kind: contactKind },
      opts.workspaceId,
    );
    const actionHash = computeActionHash({
      payeeName,
      payeePaypal: payeeEmail,
      amount,
      currency,
      purpose,
      idempotencyKey,
    });
    const ttlMinutes = Number(
      this.config.get<string>('APPROVAL_TTL_MINUTES') ?? 15,
    );
    const verdict = await this.safety.evaluateCreation({
      workspaceId: opts.workspaceId,
      type,
      payeeName,
      payeePaypal: payeeEmail,
      amount,
      currency,
      purpose,
      contact,
      sourceText: input.sourceText ?? null,
    });

    const action = await this.prisma.action.create({
      data: {
        workspaceId: opts.workspaceId,
        type,
        status: ActionStatus.PENDING_APPROVAL,
        contactId: contact?.id,
        payeeName,
        payeePaypal: payeeEmail,
        amount,
        currency,
        purpose,
        paypalRef: input.paypalRef?.trim() || null,
        extractedJson: { via: opts.via, by: opts.by, ...(input.extracted ?? {}) },
        riskFlags: verdict.flags,
        policyVersion: verdict.policyVersion,
        policyVerdict: verdict.verdict,
        safetySummary: verdict.summary,
        confidence: 0.95,
        actionHash,
        idempotencyKey,
        expiresAt: new Date(
          Date.now() +
            (Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 15) *
              60_000,
        ),
      },
    });
    await this.audit.log(action.id, 'CREATED', {
      via: opts.via,
      userId: opts.by,
    });
    await this.safety.recordGate(action.id, verdict, 1, {
      via: opts.via,
      userId: opts.by,
    });
    const blocked = verdict.verdict === 'BLOCK';
    if (blocked) {
      await this.safety.block(action.id, verdict, 1, {
        via: opts.via,
        userId: opts.by,
      });
    }
    // The card senders return 0 when the workspace has no linked chat
    // (fail-closed skip) — that is not a delivered card.
    let cardSent = false;
    try {
      const messageId = blocked
        ? await this.telegram.sendBlockedNotice(action.id, verdict.reasons)
        : await this.telegram.sendDecisionCard(action.id);
      cardSent = messageId !== 0;
    } catch (e) {
      this.logger.warn(
        `draft card send failed for ${action.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return {
      ok: !blocked,
      blocked,
      duplicate: false,
      actionId: action.id,
      cardSent,
      summary: verdict.summary,
      flags: verdict.flags,
      policyVersion: verdict.policyVersion,
    };
  }
}
