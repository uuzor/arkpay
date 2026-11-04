import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionType, ContactKind, EmailStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { computeActionHash } from '../approvals/action-hash';
import { ContactsService } from '../contacts/contacts.service';
import {
  ExtractionSchema,
  type ExtractionResult,
} from '../llm/extraction.schema';
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
  /** Proposals persisted + asked in Telegram, awaiting the confirm tap. */
  asked: number;
  skipped?: boolean;
  errors: string[];
}

export type PredraftOutcome =
  | 'drafted'
  | 'blocked'
  | 'already'
  | 'stale'
  | 'foreign'
  | 'not_found';

interface StoredEmail {
  id: string;
  workspaceId: string | null;
  from: string;
  subject: string | null;
  body: string;
}

/** Advisory Gate-1 proposal: contact + payee resolution + policy verdict, no rows written. */
type Proposal = {
  type: ActionType;
  payeeName: string;
  payeePaypal: string;
  amount: string;
  currency: string;
  purpose: string;
  dueDate: Date | null;
  contact: Awaited<ReturnType<ContactsService['findOrCreate']>>;
  verdict: Awaited<ReturnType<SafetyService['evaluateCreation']>>;
};

/**
 * The product loop: NEW email → extraction → pre-draft ask → action +
 * approval card, or a terminal email status with NO card. NOISE becomes
 * IGNORED, low-confidence or unpayable becomes NEEDS_REVIEW, policy blocks
 * never ask, and only confirmed money requests reach the draft + card.
 * Runs from the server tick and POST /pipeline/run.
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
    // Cycle with TelegramModule (see pipeline.module.ts).
    @Inject(forwardRef(() => TelegramService))
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
        asked: 0,
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
        asked: 0,
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
          else if (outcome === 'asked') result.asked += 1;
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
  ): Promise<'carded' | 'blocked' | 'ignored' | 'review' | 'asked'> {
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
    // Gate 1 runs BEFORE any ask: fraud/hard blocks never ask the user —
    // they go down the blocked path exactly as before.
    const proposal = await this.resolveProposal(email, result);
    if (!proposal) return 'review';
    if (proposal.verdict.verdict === 'BLOCK') {
      const created = await this.createActionFromExtraction(
        email,
        result,
        proposal,
      );
      if (!created) return 'review';
      return 'blocked';
    }
    // Allowable proposals wait for the human twice: first "should I draft
    // this?" (persisted, Telegram), then the approval card on the draft.
    await this.askPredraftConfirm(email, result, proposal);
    return 'asked';
  }

  /**
   * Advisory Gate-1 proposal: contact + payee resolution + policy verdict.
   * Writes no action rows (but may flag the email NEEDS_REVIEW). Run once
   * per email at ask time, and again at confirm time so the world can't
   * change under the proposal unnoticed.
   */
  private async resolveProposal(
    email: StoredEmail,
    result: ExtractionResult,
  ): Promise<Proposal | null> {
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
    return {
      type,
      payeeName,
      payeePaypal,
      amount,
      currency,
      purpose,
      dueDate,
      contact,
      verdict,
    };
  }

  /**
   * Returns the action id, or null when the extraction can't become an action
   * (payee email unresolvable) — in which case the email is NEEDS_REVIEW.
   * A pre-resolved proposal may be passed to skip the second evaluation.
   */
  private async createActionFromExtraction(
    email: StoredEmail,
    result: ExtractionResult,
    preResolved?: Proposal,
  ): Promise<{ id: string; blocked: boolean; reasons: string[] } | null> {
    const proposal =
      preResolved ?? (await this.resolveProposal(email, result));
    if (!proposal) return null;
    const {
      type,
      payeeName,
      payeePaypal,
      amount,
      currency,
      purpose,
      dueDate,
      contact,
      verdict,
    } = proposal;
    const workspaceId = email.workspaceId;
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

  /**
   * Pre-draft confirm: persist the validated extraction on the email and ask
   * the user in Telegram. No action row exists yet; the confirm tap reuses
   * the stored extraction (never re-calls the model) and runs Gate 1 fresh.
   */
  private async askPredraftConfirm(
    email: StoredEmail,
    result: ExtractionResult,
    proposal: Proposal,
  ): Promise<void> {
    const claimed = await this.prisma.email.updateMany({
      where: { id: email.id, status: EmailStatus.NEW },
      data: {
        status: EmailStatus.AWAITING_CONFIRM,
        // Round-trip strips undefined so the value is always valid JSON.
        extractedJson: JSON.parse(JSON.stringify(result)) as object,
      },
    });
    if (claimed.count === 0) {
      this.logger.warn(
        `email ${email.id} left NEW before the pre-draft ask; skipping`,
      );
      return;
    }
    this.logger.log(
      `email ${email.id} → pre-draft ask (${proposal.type} ${proposal.currency} ${proposal.amount} → ${proposal.payeePaypal})`,
    );
    try {
      await this.telegram.sendPredraftAsk(email.id);
    } catch (e) {
      // The proposal is durably AWAITING_CONFIRM; /pending re-sends the ask.
      this.logger.warn(
        `pre-draft ask send failed for ${email.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * "Yes, draft it" tap: claim the AWAITING_CONFIRM email exactly once,
   * re-validate the stored extraction, then run the standard creation path
   * — Gate 1 runs fresh, so a proposal that became unallowable since the
   * ask ends BLOCKED, never carded.
   */
  async confirmDraftProposal(
    emailId: string,
    workspaceId: string,
  ): Promise<{ outcome: PredraftOutcome; actionId?: string }> {
    const email = await this.prisma.email.findUnique({
      where: { id: emailId },
    });
    if (!email) return { outcome: 'not_found' };
    if (email.workspaceId !== workspaceId) return { outcome: 'foreign' };
    if (email.status !== EmailStatus.AWAITING_CONFIRM) {
      const existing = await this.prisma.action.findFirst({
        where: { emailId },
        select: { id: true },
      });
      return {
        outcome: 'already',
        ...(existing ? { actionId: existing.id } : {}),
      };
    }
    const parsed = ExtractionSchema.safeParse(email.extractedJson);
    if (
      !parsed.success ||
      (parsed.data.kind !== 'INVOICE_REQUEST' &&
        parsed.data.kind !== 'PAYMENT_REQUEST')
    ) {
      await this.prisma.email.updateMany({
        where: { id: emailId, status: EmailStatus.AWAITING_CONFIRM },
        data: { status: EmailStatus.NEEDS_REVIEW },
      });
      return { outcome: 'stale' };
    }
    // Claim before creating: exactly one confirmer wins the race.
    const claimed = await this.prisma.email.updateMany({
      where: { id: emailId, status: EmailStatus.AWAITING_CONFIRM },
      data: { status: EmailStatus.PROCESSED },
    });
    if (claimed.count === 0) return { outcome: 'already' };
    const created = await this.createActionFromExtraction(
      {
        id: email.id,
        workspaceId: email.workspaceId,
        from: email.from,
        subject: email.subject,
        body: email.body,
      },
      parsed.data,
    );
    if (!created) {
      // Unreachable in practice (the stored extraction resolved at ask
      // time), but the claim already flipped the status, so flag it here:
      // the NEW-guarded flagForReview inside creation can't fire anymore.
      await this.prisma.email.updateMany({
        where: { id: emailId },
        data: { status: EmailStatus.NEEDS_REVIEW },
      });
      return { outcome: 'stale' };
    }
    return {
      outcome: created.blocked ? 'blocked' : 'drafted',
      actionId: created.id,
    };
  }

  /**
   * "Ignore" tap on a pre-draft ask: terminal, idempotent, no draft ever
   * exists for the email.
   */
  async declineDraftProposal(
    emailId: string,
    workspaceId: string,
  ): Promise<{
    outcome: 'declined' | 'already' | 'foreign' | 'not_found';
  }> {
    const email = await this.prisma.email.findUnique({
      where: { id: emailId },
      select: { workspaceId: true },
    });
    if (!email) return { outcome: 'not_found' };
    if (email.workspaceId !== workspaceId) return { outcome: 'foreign' };
    const declined = await this.prisma.email.updateMany({
      where: { id: emailId, status: EmailStatus.AWAITING_CONFIRM },
      data: { status: EmailStatus.IGNORED },
    });
    return { outcome: declined.count > 0 ? 'declined' : 'already' };
  }

  /** Emails stuck at the pre-draft ask, for /pending re-surface. */
  async listAwaitingConfirm(
    workspaceId: string,
    take = 10,
  ): Promise<
    Array<{
      id: string;
      from: string;
      subject: string | null;
      receivedAt: Date;
    }>
  > {
    return this.prisma.email.findMany({
      where: { workspaceId, status: EmailStatus.AWAITING_CONFIRM },
      orderBy: { receivedAt: 'asc' },
      take: Math.min(Math.max(take, 1), 25),
      select: { id: true, from: true, subject: true, receivedAt: true },
    });
  }

  private async flagForReview(emailId: string, why: string): Promise<void> {
    this.logger.warn(`email ${emailId} NEEDS_REVIEW: ${why}`);
    await this.prisma.email.updateMany({
      where: { id: emailId, status: EmailStatus.NEW },
      data: { status: EmailStatus.NEEDS_REVIEW },
    });
  }
}
