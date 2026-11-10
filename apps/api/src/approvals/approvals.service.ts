import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionStatus, ActionType, type Action } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { DEMO_WORKSPACE_ID } from '../auth/tenant.constants';
import { ContactsService } from '../contacts/contacts.service';
import {
  PaypalApiError,
  PaypalInvoicesService,
} from '../paypal/paypal-invoices.service';
import {
  toPaypalItemId,
  PaypalPayoutsService,
  type PayoutBatch,
} from '../paypal/paypal-payouts.service';
import { PaypalDisputesService } from '../paypal/paypal-disputes.service';
import { PaypalSubscriptionsService } from '../paypal/paypal-subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
import { typeMovesMoney, type SafetyVerdict } from '../safety/policy';
import { computeActionHash } from './action-hash';

export type ExecuteReason =
  | 'executed'
  | 'not_found'
  | 'wrong_state'
  | 'expired'
  | 'hash_mismatch'
  | 'version_mismatch'
  | 'cap_exceeded'
  | 'blocked'
  | 'not_retryable'
  | 'unsupported_type'
  | 'paypal_failed'
  | 'payout_pending'
  | 'demo_readonly'
  | 'partial';

export interface ExecuteResult {
  ok: boolean;
  reason: ExecuteReason;
  paypalRef?: string;
  detail?: string;
  settled?: { executed: number; failed: number; pending: number };
}

export interface SupersedeChanges {
  payeeName?: string;
  payeePaypal?: string;
  amount?: string | number;
  currency?: string;
  purpose?: string;
}

class CapExceededError extends Error {}
class ExecuteConflictError extends Error {}
class SafetyBlockedError extends Error {
  constructor(
    readonly actionId: string,
    readonly verdict: SafetyVerdict,
  ) {
    super(verdict.summary);
  }
}

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Invoice statuses meaning "sent and beyond" (vs DRAFT / CANCELLED). */
function isDeliveredInvoiceStatus(status: string): boolean {
  const s = status.toUpperCase();
  return s !== 'DRAFT' && s !== 'CANCELLED';
}

/**
 * The ONLY path that moves money. Every execution re-verifies the approval
 * (state, expiry, hash, version), enforces caps inside the flip transaction,
 * and audits every hop. Anything unexpected refuses fail-closed: the action
 * stays APPROVED (or moves to EXPIRED/FAILED) and no PayPal call is made.
 *
 * Invoice contact learning (usualAmount/payCount) is intentionally NOT done
 * here — for an invoice, "payment complete" is observed via webhook when the
 * client pays (Phase 7), not when we send it.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly contacts: ContactsService,
    private readonly invoices: PaypalInvoicesService,
    private readonly subscriptions: PaypalSubscriptionsService,
    private readonly disputes: PaypalDisputesService,
    private readonly payouts: PaypalPayoutsService,
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

  async executeApprovedAction(
    actionId: string,
    workspaceId?: string,
  ): Promise<ExecuteResult> {
    const action = await this.prisma.action.findUnique({
      where: { id: actionId },
    });
    if (!action) return { ok: false, reason: 'not_found' };
    if (
      workspaceId &&
      action.workspaceId &&
      action.workspaceId !== workspaceId
    ) {
      return { ok: false, reason: 'not_found' };
    }
    if (action.status === ActionStatus.BLOCKED) {
      return {
        ok: false,
        reason: 'blocked',
        detail: action.safetySummary ?? 'blocked by the Payment Safety Engine',
      };
    }

    // Judge demo is invoice-live, payout-read-only: invoices execute against
    // the sandbox so judges see a real SENT; payouts refuse honestly instead
    // of failing inside PayPal (the sandbox DENIEDs them anyway).
    if (
      action.workspaceId === DEMO_WORKSPACE_ID &&
      action.type !== ActionType.INVOICE
    ) {
      await this.audit.log(actionId, 'EXECUTION_REFUSED', {
        reason: 'demo_readonly',
        type: action.type,
      });
      return {
        ok: false,
        reason: 'demo_readonly',
        detail:
          'sandbox demo: invoices execute live, payouts are read-only so shared demo funds never move',
      };
    }

    // Idempotent success: re-executing a finished action returns its ref.
    if (action.status === ActionStatus.EXECUTED) {
      return {
        ok: true,
        reason: 'executed',
        paypalRef: action.paypalRef ?? undefined,
      };
    }
    // Entry states are APPROVED (fresh) and FAILED (supervised retry). Anything
    // else — SUPERSEDED (stale approval), IGNORED, EXECUTING — refuses.
    if (
      action.status !== ActionStatus.APPROVED &&
      action.status !== ActionStatus.FAILED
    ) {
      await this.audit.log(actionId, 'EXECUTION_REFUSED', {
        reason: 'wrong_state',
        status: action.status,
      });
      return {
        ok: false,
        reason: 'wrong_state',
        detail: `status is ${action.status}, expected APPROVED or FAILED`,
      };
    }

    // A failed money-moving action is never blind-retried: PayPal has
    // accepted a second batch with the same sender_batch_id in the sandbox,
    // so a lost response could otherwise double-pay — and a lost dispute
    // offer/acceptance could double-commit. The owner must create a new
    // action. Invoices, subscription lifecycle and dispute messaging/evidence
    // are idempotent reads-before-writes, so FAILED there is retryable.
    if (
      action.status === ActionStatus.FAILED &&
      typeMovesMoney(action.type)
    ) {
      await this.audit.log(actionId, 'EXECUTION_REFUSED', {
        reason: 'not_retryable',
        type: action.type,
      });
      return {
        ok: false,
        reason: 'not_retryable',
        detail:
          'failed money-moving actions are not retried automatically; create a new action',
      };
    }

    const now = new Date();
    if (action.expiresAt.getTime() <= now.getTime()) {
      const retired = await this.prisma.action.updateMany({
        where: { id: actionId, status: action.status },
        data: { status: ActionStatus.EXPIRED },
      });
      if (retired.count === 1) {
        await this.audit.log(actionId, 'EXPIRED', { via: 'execution' });
      }
      return { ok: false, reason: 'expired' };
    }

    if (action.type === ActionType.PAYOUT_BATCH) {
      // Batch members execute atomically via executeBatch — a lone member
      // must never become its own one-item PayPal batch.
      await this.audit.log(actionId, 'EXECUTION_REFUSED', {
        reason: 'unsupported_type',
        type: action.type,
      });
      return {
        ok: false,
        reason: 'unsupported_type',
        detail:
          'batch members execute together via POST /approvals/batch/:batchId/execute',
      };
    }

    const approvalRefusal = await this.verifyApproval(action);
    if (approvalRefusal) return approvalRefusal;

    // Caps + flip commit together, or not at all.
    const amount = Number(action.amount);
    try {
      await this.prisma.$transaction(async (tx) => {
        // Gate 2: re-evaluate inside the flip transaction. A duplicate or cap
        // consumed since the card was shown refuses before any PayPal call.
        const verdict = await this.safety.evaluateExecution(tx, action);
        if (verdict.verdict === 'BLOCK') {
          throw new SafetyBlockedError(actionId, verdict);
        }
        await this.safety.recordGate(
          actionId,
          verdict,
          2,
          { via: 'execution' },
          tx,
        );
        // Caps govern money OUT. Subscription lifecycle and dispute
        // messaging/evidence move none, so they skip the cap check (Gate 2
        // above already applied the same rule via movesMoney).
        if (typeMovesMoney(action.type)) {
          await this.checkCaps(tx, action.payeePaypal, amount, action.currency);
        }
        const flipped = await tx.action.updateMany({
          where: {
            id: actionId,
            status: { in: [ActionStatus.APPROVED, ActionStatus.FAILED] },
            version: action.version,
            expiresAt: { gt: now },
          },
          data: { status: ActionStatus.EXECUTING },
        });
        if (flipped.count !== 1) throw new ExecuteConflictError();
        await this.audit.log(actionId, 'EXECUTING', {}, tx);
      });
    } catch (e) {
      if (e instanceof SafetyBlockedError) {
        // The transaction rolled back, so the row is still APPROVED. Persist
        // the block and its audit entry outside the aborted transaction.
        await this.safety.recordGate(
          actionId,
          e.verdict,
          2,
          { via: 'execution', refused: true },
        );
        await this.safety.block(
          actionId,
          e.verdict,
          2,
          { via: 'execution', refused: true },
        );
        return {
          ok: false,
          reason: 'blocked',
          detail: e.verdict.summary,
        };
      }
      if (e instanceof CapExceededError) {
        await this.audit.log(actionId, 'EXECUTION_REFUSED', {
          reason: 'cap_exceeded',
          detail: e.message,
        });
        return { ok: false, reason: 'cap_exceeded', detail: e.message };
      }
      if (e instanceof ExecuteConflictError) {
        return {
          ok: false,
          reason: 'wrong_state',
          detail: 'lost the execution race or expired mid-flight',
        };
      }
      throw e;
    }

    if (action.type === ActionType.INVOICE) {
      return this.runInvoiceFlow(actionId, action, amount);
    }
    if (action.type === ActionType.PAYOUT_SINGLE) {
      return this.runPayoutSingleFlow(actionId, action, amount);
    }
    if (
      action.type === ActionType.SUBSCRIPTION_CANCEL ||
      action.type === ActionType.SUBSCRIPTION_SUSPEND ||
      action.type === ActionType.SUBSCRIPTION_ACTIVATE
    ) {
      return this.runSubscriptionFlow(actionId, action);
    }
    if (
      action.type === ActionType.DISPUTE_MESSAGE ||
      action.type === ActionType.DISPUTE_OFFER ||
      action.type === ActionType.DISPUTE_EVIDENCE ||
      action.type === ActionType.DISPUTE_ACCEPT_CLAIM
    ) {
      return this.runDisputeFlow(actionId, action, amount);
    }
    await this.audit.log(actionId, 'EXECUTION_REFUSED', {
      reason: 'unsupported_type',
      type: action.type,
    });
    return {
      ok: false,
      reason: 'unsupported_type',
      detail: `no execution flow for ${action.type}`,
    };
  }

  /**
   * Hash + version re-verification shared by single and batch execution: the
   * stored row must still be exactly what was approved, and the approval must
   * belong to this version. Returns a refusal result, or null to proceed.
   */
  private async verifyApproval(action: Action): Promise<ExecuteResult | null> {
    const recomputed = computeActionHash({
      payeeName: action.payeeName,
      payeePaypal: action.payeePaypal,
      amount: action.amount,
      currency: action.currency,
      purpose: action.purpose,
      idempotencyKey: action.idempotencyKey,
    });
    if (recomputed !== action.actionHash) {
      await this.audit.log(action.id, 'EXECUTION_REFUSED', {
        reason: 'hash_mismatch',
      });
      return {
        ok: false,
        reason: 'hash_mismatch',
        detail: 'stored action no longer matches its approved hash',
      };
    }
    const approval = await this.prisma.auditLog.findFirst({
      where: { actionId: action.id, event: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
    });
    const approvedVersion = (approval?.detail as { version?: number } | null)
      ?.version;
    if (approvedVersion === undefined || approvedVersion !== action.version) {
      await this.audit.log(action.id, 'EXECUTION_REFUSED', {
        reason: 'version_mismatch',
        approvedVersion: approvedVersion ?? null,
        version: action.version,
      });
      return {
        ok: false,
        reason: 'version_mismatch',
        detail: 'no matching approval record for this action version',
      };
    }
    return null;
  }

  private async runInvoiceFlow(
    actionId: string,
    action: Action,
    amount: number,
  ): Promise<ExecuteResult> {
    try {
      // Resume: a previous attempt may have created the invoice before dying.
      let invoiceId = action.paypalRef;
      if (invoiceId) {
        try {
          const existing = await this.invoices.getInvoice(
            invoiceId,
            action.workspaceId,
          );
          if (isDeliveredInvoiceStatus(existing.status)) {
            await this.markExecuted(actionId, invoiceId, { via: 'resume' });
            return { ok: true, reason: 'executed', paypalRef: invoiceId };
          }
          // DRAFT: reuse it below (just send). Anything else dead: start fresh.
          if (existing.status.toUpperCase() !== 'DRAFT') invoiceId = null;
        } catch (e) {
          if (e instanceof PaypalApiError && e.status === 404) {
            this.logger.warn(
              `paypalRef ${invoiceId} unknown to PayPal; creating a fresh invoice`,
            );
            invoiceId = null;
          } else {
            throw e;
          }
        }
      }
      if (!invoiceId) {
        const draft = await this.invoices.createDraftInvoice(
          {
            recipientEmail: action.payeePaypal,
            currency: action.currency,
            note: `ArkPay action ${action.id}`,
            items: [
              {
                name: action.purpose.slice(0, 200),
                quantity: 1,
                unitAmount: amount.toFixed(2),
              },
            ],
          },
          action.workspaceId,
        );
        invoiceId = draft.id;
        // Durability marker BEFORE the send: a crash here reconciles via
        // getInvoice instead of ever creating a duplicate.
        await this.prisma.action.updateMany({
          where: { id: actionId, status: ActionStatus.EXECUTING },
          data: { paypalRef: invoiceId },
        });
      }
      await this.invoices.sendInvoice(invoiceId, action.workspaceId); // idempotent on already-sent
      await this.markExecuted(actionId, invoiceId, {});
      this.logger.log(`Executed ${actionId}: invoice ${invoiceId} sent`);
      return { ok: true, reason: 'executed', paypalRef: invoiceId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.prisma.$transaction(async (tx) => {
        await tx.action.updateMany({
          where: { id: actionId, status: ActionStatus.EXECUTING },
          data: { status: ActionStatus.FAILED },
        });
        await this.audit.log(
          actionId,
          'EXECUTION_FAILED',
          { error: msg.slice(0, 500) },
          tx,
        );
      });
      return { ok: false, reason: 'paypal_failed', detail: msg.slice(0, 300) };
    }
  }

  private async runPayoutSingleFlow(
    actionId: string,
    action: Action,
    amount: number,
  ): Promise<ExecuteResult> {
    try {
      let batch: PayoutBatch;
      if (action.paypalRef) {
        // Resume: never re-POST when a batch already exists; read its state.
        // One read only — if still processing, the reaper continues.
        batch = await this.payouts.getPayoutBatch(
          action.paypalRef,
          action.workspaceId,
        );
      } else {
        const created = await this.payouts.createPayoutBatch(
          {
            senderBatchId: action.idempotencyKey,
            requestId: action.idempotencyKey,
            items: [
              {
                receiver: action.payeePaypal,
                amount: amount.toFixed(2),
                currency: action.currency,
                note: action.purpose,
                senderItemId: toPaypalItemId(action.idempotencyKey),
              },
            ],
          },
          action.workspaceId,
        );
        await this.prisma.action.updateMany({
          where: { id: actionId, status: ActionStatus.EXECUTING },
          data: { paypalRef: created.payoutBatchId },
        });
        batch = await this.payouts.waitForTerminalBatch(
          created.payoutBatchId,
          12,
          5000,
          action.workspaceId,
        );
      }
      const outcome = await this.settlePayout(
        actionId,
        action.idempotencyKey,
        batch,
      );
      if (outcome === 'executed') {
        this.logger.log(
          `Executed ${actionId}: payout batch ${batch.payoutBatchId} settled`,
        );
        return { ok: true, reason: 'executed', paypalRef: batch.payoutBatchId };
      }
      if (outcome === 'pending') {
        return {
          ok: false,
          reason: 'payout_pending',
          paypalRef: batch.payoutBatchId,
          detail: `batch ${batch.batchStatus}; reaper will settle`,
        };
      }
      return {
        ok: false,
        reason: 'paypal_failed',
        paypalRef: batch.payoutBatchId,
        detail: 'payout failed; see EXECUTION_FAILED audit',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.failPayout(actionId, { error: msg.slice(0, 500) });
      return { ok: false, reason: 'paypal_failed', detail: msg.slice(0, 300) };
    }
  }

  /**
   * Subscription lifecycle execution: read-before-write against PayPal, so
   * a retry after a lost response reconciles instead of double-acting.
   * The subscription id is the paypalRef, set when the action was created.
   */
  private async runSubscriptionFlow(
    actionId: string,
    action: Action,
  ): Promise<ExecuteResult> {
    const subscriptionId = action.paypalRef;
    if (!subscriptionId) {
      await this.failPayout(actionId, { error: 'missing subscription id' });
      return { ok: false, reason: 'paypal_failed', detail: 'missing subscription id' };
    }
    const target =
      action.type === ActionType.SUBSCRIPTION_CANCEL
        ? 'CANCELLED'
        : action.type === ActionType.SUBSCRIPTION_SUSPEND
          ? 'SUSPENDED'
          : 'ACTIVE';
    try {
      const current = await this.subscriptions.getSubscription(
        subscriptionId,
        action.workspaceId,
      );
      if (current.status === target) {
        await this.markExecuted(actionId, subscriptionId, { via: 'resume' });
        this.logger.log(
          `Executed ${actionId}: subscription ${subscriptionId} already ${target}`,
        );
        return { ok: true, reason: 'executed', paypalRef: subscriptionId };
      }
      const reason = action.purpose.slice(0, 200) || `ArkPay action ${action.id}`;
      if (action.type === ActionType.SUBSCRIPTION_CANCEL) {
        await this.subscriptions.cancelSubscription(
          subscriptionId,
          action.workspaceId,
          reason,
        );
      } else if (action.type === ActionType.SUBSCRIPTION_SUSPEND) {
        await this.subscriptions.suspendSubscription(
          subscriptionId,
          action.workspaceId,
          reason,
        );
      } else {
        await this.subscriptions.activateSubscription(
          subscriptionId,
          action.workspaceId,
          reason,
        );
      }
      await this.markExecuted(actionId, subscriptionId, {
        from: current.status,
        to: target,
      });
      this.logger.log(
        `Executed ${actionId}: subscription ${subscriptionId} ${current.status} → ${target}`,
      );
      return { ok: true, reason: 'executed', paypalRef: subscriptionId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.failPayout(actionId, { error: msg.slice(0, 500) });
      return { ok: false, reason: 'paypal_failed', detail: msg.slice(0, 300) };
    }
  }

  /**
   * Dispute response execution. Every op re-reads the dispute first: the
   * HATEOAS links are the source of truth for what PayPal still allows
   * (a stage change since approval fails the action instead of 422ing
   * inside PayPal), and identical seller messages/evidence already present
   * are treated as idempotent success for retries.
   */
  private async runDisputeFlow(
    actionId: string,
    action: Action,
    amount: number,
  ): Promise<ExecuteResult> {
    const disputeId = action.paypalRef;
    if (!disputeId) {
      await this.failPayout(actionId, { error: 'missing dispute id' });
      return { ok: false, reason: 'paypal_failed', detail: 'missing dispute id' };
    }
    try {
      const dispute = await this.disputes.getDispute(
        disputeId,
        action.workspaceId,
      );
      const op = this.disputeOpOf(action.type);
      const payload = (action.extractedJson ?? {}) as Record<string, unknown>;
      if (op === 'message' && this.sellerMessagePresent(dispute, action.purpose)) {
        await this.markExecuted(actionId, disputeId, { via: 'resume' });
        return { ok: true, reason: 'executed', paypalRef: disputeId };
      }
      if (op === 'evidence') {
        const evidenceType = String(payload.evidenceType ?? '');
        if (
          evidenceType &&
          dispute.evidences.some(
            (e) =>
              e.source === 'SUBMITTED_BY_SELLER' &&
              e.type === evidenceType &&
              (e.notes ?? '') === (String(payload.notes ?? action.purpose)),
          )
        ) {
          await this.markExecuted(actionId, disputeId, { via: 'resume' });
          return { ok: true, reason: 'executed', paypalRef: disputeId };
        }
      }
      if (op === 'message') {
        await this.disputes.sendMessage(
          disputeId,
          action.workspaceId,
          action.purpose,
          dispute.links,
        );
      } else if (op === 'offer') {
        await this.disputes.makeOffer(
          disputeId,
          action.workspaceId,
          {
            note: action.purpose,
            offerType: String(
              payload.offerType ?? 'REFUND',
            ) as 'REFUND' | 'REFUND_WITH_RETURN' | 'REFUND_WITH_REPLACEMENT' | 'REPLACEMENT_WITHOUT_REFUND',
            amount: amount.toFixed(2),
            currency: action.currency,
            ...(typeof payload.invoiceId === 'string' && payload.invoiceId
              ? { invoiceId: payload.invoiceId }
              : {}),
          },
          dispute.links,
        );
      } else if (op === 'evidence') {
        await this.disputes.provideEvidence(
          disputeId,
          action.workspaceId,
          {
            evidenceType: String(payload.evidenceType ?? 'OTHER'),
            notes: String(payload.notes ?? action.purpose),
            ...(typeof payload.trackingNumber === 'string' && payload.trackingNumber
              ? {
                  trackingNumber: payload.trackingNumber,
                  carrierName:
                    typeof payload.carrierName === 'string'
                      ? payload.carrierName
                      : 'OTHER',
                }
              : {}),
            ...(typeof payload.refundId === 'string' && payload.refundId
              ? { refundId: payload.refundId }
              : {}),
          },
          dispute.links,
        );
      } else {
        await this.disputes.acceptClaim(
          disputeId,
          action.workspaceId,
          action.purpose,
          dispute.links,
        );
      }
      await this.markExecuted(actionId, disputeId, { op });
      this.logger.log(`Executed ${actionId}: dispute ${disputeId} ${op}`);
      return { ok: true, reason: 'executed', paypalRef: disputeId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.failPayout(actionId, { error: msg.slice(0, 500) });
      return { ok: false, reason: 'paypal_failed', detail: msg.slice(0, 300) };
    }
  }

  private disputeOpOf(type: ActionType): 'message' | 'offer' | 'evidence' | 'accept' {
    if (type === ActionType.DISPUTE_MESSAGE) return 'message';
    if (type === ActionType.DISPUTE_OFFER) return 'offer';
    if (type === ActionType.DISPUTE_EVIDENCE) return 'evidence';
    return 'accept';
  }

  /** Our exact approved text already posted by the seller: a lost response, not new work. */
  private sellerMessagePresent(
    dispute: {
      messages: Array<{ postedBy: string; content?: string }>;
    },
    purpose: string,
  ): boolean {
    return dispute.messages.some(
      (m) =>
        m.postedBy === 'SELLER' && (m.content ?? '').trim() === purpose.trim(),
    );
  }

  /**
   * Batch execution: every member verified, then ALL flipped in one
   * transaction, then ONE PayPal batch call for the whole group. All-or-
   * nothing on the way in; per-item results recorded on the way out.
   */
  async executeBatch(
    batchId: string,
    workspaceId?: string,
  ): Promise<ExecuteResult> {
    const members = await this.prisma.action.findMany({
      where: { batchId },
      orderBy: { createdAt: 'asc' },
    });
    if (members.length === 0) return { ok: false, reason: 'not_found' };
    if (
      workspaceId &&
      members.some((m) => m.workspaceId && m.workspaceId !== workspaceId)
    ) {
      return { ok: false, reason: 'not_found' };
    }

    const refuseAll = async (reason: string, detail: string) => {
      for (const m of members) {
        await this.audit.log(m.id, 'EXECUTION_REFUSED', {
          reason,
          batchId,
          detail,
        });
      }
    };

    // Batches are always payouts: the demo workspace never executes them.
    if (members.some((m) => m.workspaceId === DEMO_WORKSPACE_ID)) {
      const detail =
        'sandbox demo: invoices execute live, payouts are read-only so shared demo funds never move';
      await refuseAll('demo_readonly', detail);
      return { ok: false, reason: 'demo_readonly', detail };
    }

    for (const m of members) {
      if (
        m.status !== ActionStatus.APPROVED &&
        m.status !== ActionStatus.FAILED
      ) {
        await refuseAll('wrong_state', `member ${m.id} is ${m.status}`);
        return {
          ok: false,
          reason: 'wrong_state',
          detail: `member ${m.id} is ${m.status}; batch executes atomically or not at all`,
        };
      }
    }
    const failed = members.filter((m) => m.status === ActionStatus.FAILED);
    if (failed.length > 0) {
      await refuseAll(
        'not_retryable',
        `${failed.length} member(s) already FAILED; create a new batch`,
      );
      return {
        ok: false,
        reason: 'not_retryable',
        detail:
          'failed payout batches are not retried automatically; create a new batch',
      };
    }
    const now = new Date();
    const expired = members.filter((m) => m.expiresAt.getTime() <= now.getTime());
    if (expired.length > 0) {
      await this.prisma.action.updateMany({
        where: { batchId, status: { in: [ActionStatus.APPROVED, ActionStatus.FAILED] } },
        data: { status: ActionStatus.EXPIRED },
      });
      for (const m of expired) {
        await this.audit.log(m.id, 'EXPIRED', { via: 'execution', batchId });
      }
      return { ok: false, reason: 'expired' };
    }
    for (const m of members) {
      const refusal = await this.verifyApproval(m);
      if (refusal) {
        await refuseAll(refusal.reason, refusal.detail ?? '');
        return { ...refusal, detail: `member ${m.id}: ${refusal.detail ?? refusal.reason}` };
      }
    }

    // Static re-checks (assembly enforces these too; execution never trusts).
    const maxItems = Number(this.config.get<string>('BATCH_MAX_ITEMS') ?? 20);
    const maxTotal = Number(this.config.get<string>('BATCH_MAX_TOTAL') ?? 5000);
    if (members.length > maxItems) {
      await refuseAll('cap_exceeded', `${members.length} members over cap ${maxItems}`);
      return { ok: false, reason: 'cap_exceeded', detail: 'batch size over cap' };
    }
    const currencies = new Set(members.map((m) => m.currency));
    if (currencies.size !== 1) {
      await refuseAll('wrong_state', 'mixed currencies in one batch (v1 is single-currency)');
      return { ok: false, reason: 'wrong_state', detail: 'mixed currencies' };
    }
    const total = members.reduce((sum, m) => sum + Number(m.amount), 0);
    if (total > maxTotal) {
      await refuseAll('cap_exceeded', `total ${total} over cap ${maxTotal}`);
      return { ok: false, reason: 'cap_exceeded', detail: 'batch total over cap' };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const safetyOptions = {
          batchSize: members.length,
          batchTotal: total,
        };
        for (const m of members) {
          const verdict = await this.safety.evaluateExecution(
            tx,
            m,
            safetyOptions,
          );
          if (verdict.verdict === 'BLOCK') {
            throw new SafetyBlockedError(m.id, verdict);
          }
          await this.safety.recordGate(
            m.id,
            verdict,
            2,
            { via: 'execution', batchId },
            tx,
          );
        }
        for (const m of members) {
          await this.checkCaps(tx, m.payeePaypal, Number(m.amount), m.currency);
        }
        for (const m of members) {
          const flipped = await tx.action.updateMany({
            where: {
              id: m.id,
              status: { in: [ActionStatus.APPROVED, ActionStatus.FAILED] },
              version: m.version,
              expiresAt: { gt: now },
            },
            data: { status: ActionStatus.EXECUTING },
          });
          if (flipped.count !== 1) throw new ExecuteConflictError();
          await this.audit.log(m.id, 'EXECUTING', { batchId }, tx);
        }
      });
    } catch (e) {
      if (e instanceof SafetyBlockedError) {
        await refuseAll('blocked', e.verdict.summary);
        for (const m of members) {
          const verdict = await this.safety.evaluateExecution(
            this.prisma,
            m,
            { batchSize: members.length, batchTotal: total },
          );
          if (verdict.verdict === 'BLOCK') {
            await this.safety.recordGate(
              m.id,
              verdict,
              2,
              { via: 'execution', batchId, refused: true },
            );
            await this.safety.block(
              m.id,
              verdict,
              2,
              { via: 'execution', batchId, refused: true },
            );
          }
        }
        return { ok: false, reason: 'blocked', detail: e.verdict.summary };
      }
      if (e instanceof CapExceededError) {
        await refuseAll('cap_exceeded', e.message);
        return { ok: false, reason: 'cap_exceeded', detail: e.message };
      }
      if (e instanceof ExecuteConflictError) {
        return {
          ok: false,
          reason: 'wrong_state',
          detail: 'lost the execution race or expired mid-flight',
        };
      }
      throw e;
    }

    try {
      const refs = [...new Set(members.map((m) => m.paypalRef).filter(Boolean))];
      let batch: PayoutBatch;
      if (refs.length > 1) {
        await refuseAll('wrong_state', 'members disagree on paypalRef; supervised');
        return { ok: false, reason: 'wrong_state', detail: 'mixed paypalRef' };
      }
      // A batch is assembled from one payroll run, so all members share a
      // tenant; the guarded entry rejects mixed-tenant batches outright.
      const batchWorkspaceId = members[0].workspaceId;
      if (refs.length === 1) {
        batch = await this.payouts.getPayoutBatch(
          refs[0] as string,
          batchWorkspaceId,
        );
      } else {
        const created = await this.payouts.createPayoutBatch(
          {
            senderBatchId: batchId,
            requestId: batchId,
            emailSubject: 'You have a payout',
            items: members.map((m) => ({
              receiver: m.payeePaypal,
              amount: Number(m.amount).toFixed(2),
              currency: m.currency,
              note: m.purpose,
              senderItemId: toPaypalItemId(m.idempotencyKey),
            })),
          },
          batchWorkspaceId,
        );
        await this.prisma.action.updateMany({
          where: { batchId, status: ActionStatus.EXECUTING },
          data: { paypalRef: created.payoutBatchId },
        });
        batch = await this.payouts.waitForTerminalBatch(
          created.payoutBatchId,
          12,
          5000,
          batchWorkspaceId,
        );
      }
      const settled = { executed: 0, failed: 0, pending: 0 };
      for (const m of members) {
        const outcome = await this.settlePayout(m.id, m.idempotencyKey, batch);
        settled[outcome] += 1;
      }
      this.logger.log(
        `Batch ${batchId}: ${settled.executed}/${members.length} executed, ${settled.failed} failed, ${settled.pending} pending (${batch.payoutBatchId})`,
      );
      if (settled.failed === 0 && settled.pending === 0) {
        return { ok: true, reason: 'executed', paypalRef: batch.payoutBatchId, settled };
      }
      if (settled.pending > 0 && settled.failed === 0) {
        return {
          ok: false,
          reason: 'payout_pending',
          paypalRef: batch.payoutBatchId,
          settled,
          detail: `batch ${batch.batchStatus}; reaper will settle`,
        };
      }
      return {
        ok: false,
        reason: 'partial',
        paypalRef: batch.payoutBatchId,
        settled,
        detail: 'partial batch failure; see per-member audits',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const m of members) {
        await this.failPayout(m.id, { batchId, error: msg.slice(0, 500) });
      }
      return { ok: false, reason: 'paypal_failed', detail: msg.slice(0, 300) };
    }
  }

  /**
   * Sync every EXECUTING row carrying this PayPal batch ref against live
   * batch state. Shared by webhooks and the reaper — one settle path for
   * anything that didn't settle inline during execution.
   */
  async syncPayoutBatch(payoutBatchId: string): Promise<{
    batchStatus: string;
    settled: { executed: number; failed: number; pending: number };
  }> {
    const rows = await this.prisma.action.findMany({
      where: {
        paypalRef: payoutBatchId,
        status: ActionStatus.EXECUTING,
        type: { in: [ActionType.PAYOUT_SINGLE, ActionType.PAYOUT_BATCH] },
      },
    });
    const settled = { executed: 0, failed: 0, pending: 0 };
    if (rows.length === 0) {
      // Nothing we track references this batch — no PayPal call to make.
      return { batchStatus: 'UNKNOWN', settled };
    }
    // The batch belongs to whoever executed it; resolve the tenant from the
    // rows before touching PayPal (10d fails closed when unattributed).
    const batch = await this.payouts.getPayoutBatch(
      payoutBatchId,
      rows[0].workspaceId,
    );
    for (const row of rows) {
      const outcome = await this.settlePayout(
        row.id,
        row.idempotencyKey,
        batch,
      );
      settled[outcome] += 1;
    }
    return { batchStatus: batch.batchStatus, settled };
  }

  /**
   * Settle ONE action row against live batch state. Shared by execute, batch,
   * webhook, and reaper paths so all four agree. UNCLAIMED counts as
   * executed — the money left our account; claiming is the recipient's move
   * (and webhooks track it). Anything still moving returns 'pending' with NO
   * write, so the reaper keeps watching it.
   */
  private async settlePayout(
    actionId: string,
    idempotencyKey: string,
    batch: PayoutBatch,
  ): Promise<'executed' | 'failed' | 'pending'> {
    const status = batch.batchStatus.toUpperCase();
    if (status === 'DENIED' || status === 'CANCELED') {
      await this.failPayout(actionId, {
        paypalRef: batch.payoutBatchId,
        batchStatus: status,
      });
      return 'failed';
    }
    if (status !== 'SUCCESS') return 'pending';
    const item = batch.items.find(
      (it) => it.senderItemId === toPaypalItemId(idempotencyKey),
    );
    if (!item) {
      await this.failPayout(actionId, {
        paypalRef: batch.payoutBatchId,
        batchStatus: status,
        detail: 'item missing from batch response',
      });
      return 'failed';
    }
    const itemStatus = item.transactionStatus.toUpperCase();
    const detail = {
      paypalRef: batch.payoutBatchId,
      payoutItemId: item.payoutItemId,
      transactionId: item.transactionId ?? null,
      transactionStatus: item.transactionStatus,
      receiver: item.receiver ?? null,
    };
    if (itemStatus === 'SUCCESS' || itemStatus === 'UNCLAIMED') {
      await this.markExecuted(actionId, batch.payoutBatchId, detail);
      await this.learnPayout(actionId);
      return 'executed';
    }
    if (
      itemStatus === 'PENDING' ||
      itemStatus === 'PROCESSING' ||
      itemStatus === 'ONHOLD'
    ) {
      return 'pending';
    }
    await this.failPayout(actionId, {
      ...detail,
      errors: item.errors == null ? null : JSON.stringify(item.errors).slice(0, 500),
    });
    return 'failed';
  }

  private async failPayout(
    actionId: string,
    detail: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.action.updateMany({
        where: { id: actionId, status: ActionStatus.EXECUTING },
        data: { status: ActionStatus.FAILED },
      });
      await this.audit.log(actionId, 'EXECUTION_FAILED', detail, tx);
    });
  }

  /** Best-effort contact learning after a completed payout. Never fails execution. */
  private async learnPayout(actionId: string): Promise<void> {
    try {
      const row = await this.prisma.action.findUnique({
        where: { id: actionId },
        select: { contactId: true, amount: true, currency: true, workspaceId: true },
      });
      if (!row?.contactId) return;
      await this.contacts.recordPayment(
        row.contactId,
        Number(row.amount),
        row.currency,
        row.workspaceId,
      );
    } catch (e) {
      this.logger.warn(
        `contact learning skipped for ${actionId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Edit-after-approval: the old action is voided (SUPERSEDED) and a new
   * PENDING_APPROVAL action carries the merged values with a fresh
   * idempotency key, hash, version, and expiry. The old approval can never
   * execute — execution refuses anything not APPROVED/FAILED.
   */
  async supersede(
    actionId: string,
    changes: SupersedeChanges,
    by = 'api',
    workspaceId?: string,
  ): Promise<{ oldId: string; newId: string }> {
    const old = await this.prisma.action.findUnique({
      where: { id: actionId },
      include: { contact: { select: { kind: true } } },
    });
    if (!old) throw new NotFoundException(`action ${actionId} not found`);
    if (workspaceId && old.workspaceId && old.workspaceId !== workspaceId) {
      throw new NotFoundException(`action ${actionId} not found`);
    }
    if (
      old.status !== ActionStatus.APPROVED &&
      old.status !== ActionStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException(
        `cannot edit action in status ${old.status}`,
      );
    }
    if (old.type === ActionType.PAYOUT_BATCH) {
      // A revised member would orphan the batch's atomicity — ignore the
      // batch and reassemble instead.
      throw new BadRequestException(
        'cannot supersede a batch member; ignore the batch and reassemble it',
      );
    }

    const merged = {
      payeeName: (changes.payeeName ?? old.payeeName).trim(),
      payeePaypal: (changes.payeePaypal ?? old.payeePaypal).trim().toLowerCase(),
      amount: String(changes.amount ?? old.amount).trim(),
      currency: (changes.currency ?? old.currency).trim().toUpperCase(),
      purpose: (changes.purpose ?? old.purpose).trim(),
    };
    if (!merged.payeeName || !merged.purpose) {
      throw new BadRequestException('payee name and purpose are required');
    }
    if (!EMAIL_RE.test(merged.payeePaypal)) {
      throw new BadRequestException(
        `invalid PayPal email: ${merged.payeePaypal}`,
      );
    }
    if (!AMOUNT_RE.test(merged.amount)) {
      throw new BadRequestException(`invalid amount: ${merged.amount}`);
    }
    if (!CURRENCY_RE.test(merged.currency)) {
      throw new BadRequestException(`invalid currency: ${merged.currency}`);
    }
    const same =
      merged.payeeName === old.payeeName &&
      merged.payeePaypal === old.payeePaypal &&
      Number(merged.amount) === Number(old.amount) &&
      merged.currency === old.currency &&
      merged.purpose === old.purpose;
    if (same) {
      throw new BadRequestException('no changes — nothing to supersede');
    }

    const tenantId = old.workspaceId;
    const contact = await this.contacts.findOrCreate(
      {
        name: merged.payeeName,
        paypalEmail: merged.payeePaypal,
        kind: old.contact?.kind,
      },
      tenantId,
    );
    const verdict = await this.safety.evaluateCreation({
      workspaceId: tenantId,
      type: old.type,
      ...merged,
      contact,
    });
    if (verdict.verdict === 'BLOCK') {
      throw new BadRequestException(
        `Safety Engine blocked this edit: ${verdict.summary}`,
      );
    }
    const idempotencyKey = randomUUID();
    const actionHash = computeActionHash({ ...merged, idempotencyKey });
    const priorExtracted =
      typeof old.extractedJson === 'object' && old.extractedJson !== null
        ? (old.extractedJson as Record<string, unknown>)
        : {};

    const created = await this.prisma.$transaction(async (tx) => {
      const next = await tx.action.create({
        data: {
          workspaceId: tenantId,
          type: old.type,
          status: ActionStatus.PENDING_APPROVAL,
          emailId: old.emailId,
          contactId: contact.id,
          ...merged,
          extractedJson: { ...priorExtracted, supersededFrom: old.id },
          riskFlags: verdict.flags,
          policyVersion: verdict.policyVersion,
          policyVerdict: verdict.verdict,
          safetySummary: verdict.summary,
          confidence: old.confidence,
          actionHash,
          idempotencyKey,
          version: old.version + 1,
          expiresAt: this.expiryFromNow(),
        },
      });
      const voided = await tx.action.updateMany({
        where: {
          id: old.id,
          status: { in: [ActionStatus.APPROVED, ActionStatus.PENDING_APPROVAL] },
        },
        data: { status: ActionStatus.SUPERSEDED },
      });
      if (voided.count !== 1) {
        throw new BadRequestException(
          `action ${old.id} changed state mid-edit; retry`,
        );
      }
      await this.audit.log(
        old.id,
        'SUPERSEDED',
        { by, supersededBy: next.id },
        tx,
      );
      await this.audit.log(
        next.id,
        'CREATED',
        { via: 'supersede', supersedes: old.id, by },
        tx,
      );
      await this.safety.recordGate(
        next.id,
        verdict,
        1,
        { via: 'supersede', supersedes: old.id, by },
        tx,
      );
      return next;
    });
    return { oldId: old.id, newId: created.id };
  }

  /**
   * Boot reaper (also POST /approvals/reconcile): rows stuck in EXECUTING
   * older than `staleMinutes` are reconciled against PayPal instead of
   * retried blindly. DRAFT-or-unknown → back to APPROVED for a supervised
   * retry; sent-or-beyond → EXECUTED; CANCELLED → FAILED. Non-invoice rows
   * are left for Phase 6.
   */
  async reconcileStaleExecuting(staleMinutes = 5): Promise<{
    reconciled: number;
    requeued: number;
    failed: number;
    skipped: number;
  }> {
    const counts = { reconciled: 0, requeued: 0, failed: 0, skipped: 0 };
    const cutoff = new Date(Date.now() - staleMinutes * 60_000);
    const stale = await this.prisma.action.findMany({
      where: { status: ActionStatus.EXECUTING, updatedAt: { lt: cutoff } },
    });
    const payoutRows: typeof stale = [];
    for (const row of stale) {
      if (
        row.type === ActionType.PAYOUT_SINGLE ||
        row.type === ActionType.PAYOUT_BATCH
      ) {
        payoutRows.push(row);
        continue;
      }
      if (row.type !== ActionType.INVOICE) {
        counts.skipped += 1;
        continue;
      }
      if (!row.paypalRef) {
        // Died before any PayPal call — nothing to reconcile, safe to requeue.
        await this.requeue(row.id, 'no paypalRef; crashed before PayPal call');
        counts.requeued += 1;
        continue;
      }
      try {
        const invoice = await this.invoices.getInvoice(
          row.paypalRef,
          row.workspaceId,
        );
        const status = invoice.status.toUpperCase();
        if (status === 'DRAFT') {
          await this.requeue(row.id, `invoice ${row.paypalRef} still DRAFT`);
          counts.requeued += 1;
        } else if (status === 'CANCELLED') {
          await this.prisma.$transaction(async (tx) => {
            await tx.action.updateMany({
              where: { id: row.id, status: ActionStatus.EXECUTING },
              data: { status: ActionStatus.FAILED },
            });
            await this.audit.log(
              row.id,
              'EXECUTION_FAILED',
              { via: 'reconcile', status },
              tx,
            );
          });
          counts.failed += 1;
        } else {
          await this.markExecuted(row.id, row.paypalRef, { via: 'reconcile' });
          counts.reconciled += 1;
        }
      } catch (e) {
        // Transient (network/5xx): leave the row for the next reconcile.
        this.logger.warn(
          `reconcile of ${row.id} deferred: ${e instanceof Error ? e.message : String(e)}`,
        );
        counts.skipped += 1;
      }
    }
    // Stale payout rows sync against live batch state, grouped by PayPal ref
    // (one GET per batch). A row without a ref may have crashed before OR
    // after PayPal created the batch — and PayPal has been observed to accept
    // a second batch with the same sender_batch_id. Never blind-retry money
    // out; require a human-created action.
    for (const row of payoutRows.filter((r) => !r.paypalRef)) {
      const changed = await this.prisma.action.updateMany({
        where: { id: row.id, status: ActionStatus.EXECUTING },
        data: { status: ActionStatus.FAILED },
      });
      if (changed.count === 1) {
        await this.audit.log(row.id, 'PAYOUT_UNKNOWN', {
          reason:
            'stale EXECUTING payout without a PayPal batch ref; not retried automatically',
        });
        counts.failed += 1;
      } else {
        counts.skipped += 1;
      }
    }
    const refs = [
      ...new Set(
        payoutRows.filter((r) => r.paypalRef).map((r) => r.paypalRef as string),
      ),
    ];
    for (const ref of refs) {
      const groupSize = payoutRows.filter((r) => r.paypalRef === ref).length;
      try {
        const { settled } = await this.syncPayoutBatch(ref);
        counts.reconciled += settled.executed;
        counts.failed += settled.failed;
        counts.skipped += settled.pending;
      } catch (e) {
        this.logger.warn(
          `reconcile of payout batch ${ref} deferred: ${e instanceof Error ? e.message : String(e)}`,
        );
        counts.skipped += groupSize;
      }
    }
    return counts;
  }

  private async markExecuted(
    actionId: string,
    paypalRef: string,
    detail: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.action.updateMany({
        where: { id: actionId, status: ActionStatus.EXECUTING },
        data: { status: ActionStatus.EXECUTED, paypalRef },
      });
      if (done.count !== 1) {
        this.logger.warn(
          `markExecuted lost the race for ${actionId}; another worker finished it`,
        );
        return;
      }
      await this.audit.log(actionId, 'EXECUTED', { paypalRef, ...detail }, tx);
    });
  }

  private async requeue(actionId: string, why: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.action.updateMany({
        where: { id: actionId, status: ActionStatus.EXECUTING },
        data: { status: ActionStatus.APPROVED },
      });
      await this.audit.log(actionId, 'REQUEUED', { via: 'reconcile', why }, tx);
    });
  }

  /**
   * Spend caps, enforced inside the APPROVED → EXECUTING transaction with
   * per-vendor and global advisory locks, so two concurrent executions can't
   * both slip under a cap. Caps govern money OUT (payouts); invoices request
   * money IN and always pass until payouts exist — the mechanism is real and
   * Phase 6 reuses it unchanged. Same-currency sums only (documented limit).
   */
  private async checkCaps(
    tx: {
      $executeRaw: PrismaService['$executeRaw'];
      action: PrismaService['action'];
    },
    vendor: string,
    amount: number,
    currency: string,
  ): Promise<void> {
    const vendorCap = Number(
      this.config.get<string>('VENDOR_DAILY_CAP') ?? 500,
    );
    const globalCap = Number(
      this.config.get<string>('GLOBAL_DAILY_CAP') ?? 2000,
    );
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arkpay:exec:${vendor.toLowerCase()}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arkpay:exec:global'))`;
    const spentToday = async (where: {
      payeePaypal?: { equals: string; mode: 'insensitive' };
    }): Promise<number> => {
      const agg = await tx.action.aggregate({
        _sum: { amount: true },
        where: {
          ...where,
          currency,
          status: { in: [ActionStatus.EXECUTING, ActionStatus.EXECUTED] },
          type: {
            in: [
              ActionType.PAYOUT_SINGLE,
              ActionType.PAYOUT_BATCH,
              ActionType.DISPUTE_OFFER,
              ActionType.DISPUTE_ACCEPT_CLAIM,
            ],
          },
          updatedAt: { gte: dayStart },
        },
      });
      return Number(agg._sum.amount ?? 0);
    };
    const vendorSpent = await spentToday({
      payeePaypal: { equals: vendor, mode: 'insensitive' },
    });
    if (vendorSpent + amount > vendorCap) {
      throw new CapExceededError(
        `vendor ${vendor}: ${vendorSpent} + ${amount} exceeds ${vendorCap} ${currency}/day`,
      );
    }
    const globalSpent = await spentToday({});
    if (globalSpent + amount > globalCap) {
      throw new CapExceededError(
        `global: ${globalSpent} + ${amount} exceeds ${globalCap} ${currency}/day`,
      );
    }
  }
}
