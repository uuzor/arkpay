import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionType, ContactKind, EmailStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { computeActionHash } from '../approvals/action-hash';
import { ContactsService } from '../contacts/contacts.service';
import type { ExtractionResult } from '../llm/extraction.schema';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
import { TelegramService } from '../telegram/telegram.service';

export interface PipelineRunResult {
  processed: number;
  carded: number;
  blocked: number;
  ignored: number;
  needsReview: number;
  skipped?: boolean;
  errors: string[];
}

interface StoredEmail {
  id: string;
  workspaceId: string | null;
  from: string;
  subject: string | null;
  body: string;
}

/**
 * The product loop: NEW email → extraction → action + approval card, or a
 * terminal email status with NO card. NOISE becomes IGNORED, low-confidence
 * or unpayable becomes NEEDS_REVIEW, and only confident, complete money
 * requests reach Telegram. Runs from the server tick and POST /pipeline/run.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly llm: LlmService,
    private readonly contacts: ContactsService,
    private readonly telegram: TelegramService,
    private readonly safety: SafetyService,
  ) {}

  private expiryFromNow(): Date {
    const ttlMinutes = Number(
      this.config.get<string>('APPROVAL_TTL_MINUTES') ?? 15,
    );
    const ttl =
      Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 15;
    return new Date(Date.now() + ttl * 60_000);
  }

  async processNewEmails(
    limit = 5,
    workspaceId?: string,
  ): Promise<PipelineRunResult> {
    if (this.running) {
      return {
        processed: 0,
        carded: 0,
        blocked: 0,
        ignored: 0,
        needsReview: 0,
        skipped: true,
        errors: [],
      };
    }
    this.running = true;
    try {
      const result: PipelineRunResult = {
        processed: 0,
        carded: 0,
        blocked: 0,
        ignored: 0,
        needsReview: 0,
        errors: [],
      };
      const emails = await this.prisma.email.findMany({
        where: {
          status: EmailStatus.NEW,
          ...(workspaceId ? { workspaceId } : {}),
        },
        orderBy: { receivedAt: 'asc' },
        take: Math.min(Math.max(limit, 1), 25),
      });
      for (const email of emails) {
        result.processed += 1;
        try {
          const outcome = await this.processOne(email);
          if (outcome === 'carded') result.carded += 1;
          else if (outcome === 'blocked') result.blocked += 1;
          else if (outcome === 'ignored') result.ignored += 1;
          else result.needsReview += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.errors.push(`${email.id}: ${msg}`);
          this.logger.error(`pipeline failed for ${email.id}: ${msg}`);
        }
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  async status(workspaceId?: string) {
    const tenant = workspaceId ? { workspaceId } : {};
    const [byStatus, pendingActions] = await Promise.all([
      this.prisma.email.groupBy({
        by: ['status'],
        where: tenant,
        _count: { status: true },
      }),
      this.prisma.action.count({
        where: { status: 'PENDING_APPROVAL', ...tenant },
      }),
    ]);
    const emails: Record<string, number> = {};
    for (const row of byStatus) emails[row.status] = row._count.status;
    return { emails, pendingActions, running: this.running };
  }

  private async processOne(
    email: StoredEmail,
  ): Promise<'carded' | 'blocked' | 'ignored' | 'review'> {
    const { result, status } = await this.llm.processStoredEmail(email.id);
    if (!result || status !== EmailStatus.NEW) {
      // Terminal statuses were already persisted by processStoredEmail.
      return status === EmailStatus.IGNORED ? 'ignored' : 'review';
    }
    // Application-level dedupe: one action per email in v1 (no schema change;
    // the tick is serial and single-process, so the window is tiny).
    const existing = await this.prisma.action.findFirst({
      where: { emailId: email.id },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.email.updateMany({
        where: { id: email.id, status: EmailStatus.NEW },
        data: { status: EmailStatus.PROCESSED },
      });
      this.logger.warn(
        `email ${email.id} already has action ${existing.id}; marked PROCESSED`,
      );
      return 'review';
    }
    const created = await this.createActionFromExtraction(email, result);
    if (!created) return 'review';
    return created.blocked ? 'blocked' : 'carded';
  }

  /**
   * Returns the action id, or null when the extraction can't become an action
   * (payee email unresolvable) — in which case the email is NEEDS_REVIEW.
   */
  private async createActionFromExtraction(
    email: StoredEmail,
    result: ExtractionResult,
  ): Promise<{ id: string; blocked: boolean; reasons: string[] } | null> {
    if (
      result.kind !== 'INVOICE_REQUEST' &&
      result.kind !== 'PAYMENT_REQUEST'
    ) {
      return null;
    }
    const type =
      result.kind === 'INVOICE_REQUEST'
        ? ActionType.INVOICE
        : ActionType.PAYOUT_SINGLE;
    const payeeName = result.payeeName?.trim();
    const amount = result.amount?.trim();
    const currency = result.currency?.trim();
    const purpose = result.purpose?.trim();
    if (!payeeName || !amount || !currency || !purpose) {
      // Unreachable via the zod schema (money kinds require these), but the
      // pipeline never trusts its input — flag instead of throwing.
      await this.flagForReview(email.id, 'extraction missing required fields');
      return null;
    }
    // Someone we bill is a CLIENT; someone we pay defaults to SUPPLIER
    // (STAFF comes from explicit setup, never inference).
    const workspaceId = email.workspaceId;
    const contact = await this.contacts.findOrCreate(
      {
        name: payeeName,
        paypalEmail: result.payeeEmail ?? undefined,
        kind: type === ActionType.INVOICE ? ContactKind.CLIENT : ContactKind.SUPPLIER,
      },
      workspaceId,
    );
    // Never invent a money address. The stated email wins; else the contact
    // book's stored address; else a human must supply one.
    const payeePaypal = result.payeeEmail ?? contact.paypalEmail;
    if (!payeePaypal) {
      await this.flagForReview(email.id, `no PayPal email for ${payeeName}`);
      return null;
    }
    let dueDate: Date | null = null;
    if (result.dueDate) {
      const parsed = new Date(`${result.dueDate}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) dueDate = parsed;
      else this.logger.warn(`email ${email.id}: dropping bad dueDate ${result.dueDate}`);
    }
    // Gate 1: policy runs before any card exists. It is the same evaluator
    // Gate 2 uses, so the card cannot promise a verdict execution will reject.
    const verdict = await this.safety.evaluateCreation({
      workspaceId,
      type,
      payeeName,
      payeePaypal,
      amount,
      currency,
      purpose,
      dueDate,
      contact,
      sourceText: email.body,
      extractedSignals: result.injectionSignals,
    });
    const idempotencyKey = randomUUID();
    const action = await this.prisma.$transaction(async (tx) => {
      const created = await tx.action.create({
        data: {
          workspaceId,
          type,
          status: 'PENDING_APPROVAL',
          emailId: email.id,
          contactId: contact.id,
          payeeName,
          payeePaypal,
          amount,
          currency,
          purpose,
          dueDate,
          // Round-trip strips undefined so the value is always valid JSON.
          extractedJson: JSON.parse(JSON.stringify(result)) as object,
          riskFlags: verdict.flags,
          policyVersion: verdict.policyVersion,
          policyVerdict: verdict.verdict,
          safetySummary: verdict.summary,
          confidence: result.confidence,
          actionHash: computeActionHash({
            payeeName,
            payeePaypal,
            amount,
            currency,
            purpose,
            idempotencyKey,
          }),
          idempotencyKey,
          version: 1,
          expiresAt: this.expiryFromNow(),
        },
      });
      await this.safety.recordGate(
        created.id,
        verdict,
        1,
        { via: 'email-pipeline', emailId: email.id },
        tx,
      );
      if (verdict.verdict === 'BLOCK') {
        await this.safety.block(
          created.id,
          verdict,
          1,
          { via: 'email-pipeline', emailId: email.id },
          tx,
        );
      }
      await tx.email.updateMany({
        where: { id: email.id, status: EmailStatus.NEW },
        data: { status: EmailStatus.PROCESSED },
      });
      return created;
    });
    const blocked = verdict.verdict === 'BLOCK';
    this.logger.log(
      `email ${email.id} → action ${action.id} (${type} ${currency} ${amount} → ${payeePaypal}) ${verdict.verdict}`,
    );
    try {
      if (blocked) {
        await this.telegram.sendBlockedNotice(action.id, verdict.reasons);
      } else {
        await this.telegram.sendDecisionCard(action.id);
      }
    } catch (e) {
      // The action is durably PENDING/BLOCKED; /pending or /blocked can
      // re-send the message.
      this.logger.warn(
        `card send failed for ${action.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return { id: action.id, blocked, reasons: verdict.reasons };
  }

  private async flagForReview(emailId: string, why: string): Promise<void> {
    this.logger.warn(`email ${emailId} NEEDS_REVIEW: ${why}`);
    await this.prisma.email.updateMany({
      where: { id: emailId, status: EmailStatus.NEW },
      data: { status: EmailStatus.NEEDS_REVIEW },
    });
  }
}
