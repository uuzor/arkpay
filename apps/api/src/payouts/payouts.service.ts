import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionType, ContactKind, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { computeActionHash } from '../approvals/action-hash';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
import type { SafetyVerdict } from '../safety/policy';

export interface TeamBatchItemOverride {
  contactId?: string;
  /** Matched case-insensitively when contactId is absent. */
  name?: string;
  amount?: string | number;
}

export interface AssembleTeamBatchInput {
  items?: TeamBatchItemOverride[];
  note?: string;
}

export interface AssembleTeamBatchOptions {
  /** Join an existing transaction (used by monthly payroll prep). */
  tx?: Prisma.TransactionClient;
  /** Caller-supplied batch id; defaults to a fresh UUID. */
  batchId?: string;
  /** Override the batch purpose. */
  purpose?: string;
  /** Tenant; required, no fallback. */
  workspaceId: string;
}

export interface AssembledRecipient {
  actionId: string;
  contactId: string;
  payeeName: string;
  payeePaypal: string;
  amount: string;
  flags: string[];
}

export interface AssembledBatch {
  batchId: string;
  currency: string;
  total: string;
  included: AssembledRecipient[];
  excluded: { name: string; reason: string }[];
}

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

/**
 * "Pay my team" assembly: resolves STAFF contacts into one PENDING batch of
 * PAYOUT_BATCH member rows sharing a batchId. Amounts come from explicit
 * overrides or each contact's learned usualAmount — never invented. Anyone
 * unpayable is EXCLUDED with a reason (returned, and shown on the card)
 * rather than guessed.
 *
 * Assembly is deliberately card-agnostic: it returns the batch and the
 * telegram layer renders + sends the approval card.
 */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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

  async assembleTeamBatch(
    input: AssembleTeamBatchInput,
    options: AssembleTeamBatchOptions,
  ): Promise<AssembledBatch> {
    const workspaceId = options.workspaceId;
    const staff = await this.prisma.contact.findMany({
      where: { workspaceId, kind: ContactKind.STAFF },
      orderBy: { name: 'asc' },
    });
    if (staff.length === 0) {
      throw new BadRequestException(
        'no STAFF contacts — add some via POST /contacts first',
      );
    }
    const overrides = input.items ?? [];
    const findOverride = (contactId: string, name: string) =>
      overrides.find((o) =>
        o.contactId
          ? o.contactId === contactId
          : o.name?.trim().toLowerCase() === name.toLowerCase(),
      );
    for (const o of overrides) {
      const matched = staff.some((c) =>
        o.contactId
          ? o.contactId === c.id
          : o.name?.trim().toLowerCase() === c.name.toLowerCase(),
      );
      if (!matched) {
        throw new BadRequestException(
          `override matches no STAFF contact: ${o.contactId ?? o.name ?? '(empty)'}`,
        );
      }
    }

    const included: Array<{
      contactId: string;
      contact: (typeof staff)[number];
      payeeName: string;
      payeePaypal: string;
      amount: string;
      currency: string;
      flags: string[];
      verdict?: SafetyVerdict;
    }> = [];
    const excluded: { name: string; reason: string }[] = [];
    for (const c of staff) {
      if (!c.paypalEmail) {
        excluded.push({ name: c.name, reason: 'no PayPal email' });
        continue;
      }
      const override = findOverride(c.id, c.name);
      const rawAmount =
        override?.amount !== undefined
          ? String(override.amount).trim()
          : c.usualAmount !== null
            ? String(c.usualAmount)
            : null;
      if (rawAmount === null) {
        excluded.push({
          name: c.name,
          reason: 'no usual amount — specify amount explicitly',
        });
        continue;
      }
      if (!AMOUNT_RE.test(rawAmount) || Number(rawAmount) <= 0) {
        throw new BadRequestException(
          `invalid amount for ${c.name}: ${rawAmount}`,
        );
      }
      included.push({
        contactId: c.id,
        contact: c,
        payeeName: c.name,
        payeePaypal: c.paypalEmail,
        amount: rawAmount,
        currency: c.currency,
        flags: [],
      });
    }
    if (included.length === 0) {
      throw new BadRequestException(
        `no payable staff (${excluded.map((e) => `${e.name}: ${e.reason}`).join('; ')})`,
      );
    }
    const currencies = new Set(included.map((i) => i.currency));
    if (currencies.size !== 1) {
      throw new BadRequestException(
        'single currency per batch in v1 — split mixed-currency teams into one batch each',
      );
    }
    const maxItems = Number(this.config.get<string>('BATCH_MAX_ITEMS') ?? 20);
    const maxTotal = Number(this.config.get<string>('BATCH_MAX_TOTAL') ?? 5000);
    if (included.length > maxItems) {
      throw new BadRequestException(
        `batch size ${included.length} over cap ${maxItems}`,
      );
    }
    let total = included.reduce((sum, i) => sum + Number(i.amount), 0);
    if (total > maxTotal) {
      throw new BadRequestException(
        `batch total ${total} over cap ${maxTotal}`,
      );
    }

    // Gate 1 for every member: a hard-blocked recipient is excluded from the
    // card with its policy reason rather than silently paid.
    const purpose = (
      options.purpose ??
      input.note ??
      'Team payout'
    ).trim() || 'Team payout';
    for (const item of [...included]) {
      const verdict = await this.safety.evaluateCreation({
        workspaceId,
        type: ActionType.PAYOUT_BATCH,
        payeeName: item.payeeName,
        payeePaypal: item.payeePaypal,
        amount: item.amount,
        currency: item.currency,
        purpose,
        contact: item.contact,
        batchSize: included.length,
        batchTotal: included.reduce((sum, i) => sum + Number(i.amount), 0),
      });
      if (verdict.verdict === 'BLOCK') {
        excluded.push({ name: item.payeeName, reason: verdict.summary });
        included.splice(included.indexOf(item), 1);
      } else {
        item.verdict = verdict;
        item.flags = verdict.flags;
      }
    }
    if (included.length === 0) {
      throw new BadRequestException(
        `no payable staff after safety checks (${excluded.map((e) => `${e.name}: ${e.reason}`).join('; ')})`,
      );
    }
    total = included.reduce((sum, i) => sum + Number(i.amount), 0);
    if (total > maxTotal) {
      throw new BadRequestException(
        `batch total ${total} over cap ${maxTotal}`,
      );
    }

    const batchId = options.batchId ?? randomUUID();
    const currency = included[0].currency;
    const expiresAt = this.expiryFromNow();
    const createRows = async (tx: Prisma.TransactionClient) => {
      const rows = [];
      for (const i of included) {
        const idempotencyKey = randomUUID();
        const row = await tx.action.create({
          data: {
            workspaceId,
            type: ActionType.PAYOUT_BATCH,
            status: 'PENDING_APPROVAL',
            contactId: i.contactId,
            payeeName: i.payeeName,
            payeePaypal: i.payeePaypal,
            amount: i.amount,
            currency: i.currency,
            purpose,
            extractedJson: { via: 'team-assembly', batchId },
            riskFlags: i.verdict?.flags ?? [],
            policyVersion: i.verdict?.policyVersion,
            policyVerdict: i.verdict?.verdict,
            safetySummary: i.verdict?.summary,
            confidence: null,
            actionHash: computeActionHash({
              payeeName: i.payeeName,
              payeePaypal: i.payeePaypal,
              amount: i.amount,
              currency: i.currency,
              purpose,
              idempotencyKey,
            }),
            idempotencyKey,
            batchId,
            version: 1,
            expiresAt,
          },
        });
        rows.push(row);
      }
      return rows;
    };
    const created = options.tx
      ? await createRows(options.tx)
      : await this.prisma.$transaction(createRows);
    const auditDb = options.tx ?? this.prisma;
    for (let idx = 0; idx < created.length; idx += 1) {
      const verdict = included[idx].verdict;
      if (verdict) {
        await this.safety.recordGate(
          created[idx].id,
          verdict,
          1,
          { via: 'team-assembly', batchId },
          auditDb,
        );
      }
    }
    return {
      batchId,
      currency,
      total: total.toFixed(2),
      included: created.map((row, idx) => ({
        actionId: row.id,
        contactId: included[idx].contactId,
        payeeName: included[idx].payeeName,
        payeePaypal: included[idx].payeePaypal,
        amount: included[idx].amount,
        flags: included[idx].verdict?.flags ?? [],
      })),
      excluded,
    };
  }
}
