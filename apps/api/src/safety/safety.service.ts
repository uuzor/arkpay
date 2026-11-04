import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionStatus,
  ActionType,
  Prisma,
  type Action,
  type Contact,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_SAFETY_POLICY,
  POLICY_RULES,
  SAFETY_POLICY_VERSION,
  evaluateSafety,
  type SafetyApproval,
  type SafetyContact,
  type SafetyEvaluationInput,
  type SafetyHistory,
  type SafetyPolicyConfig,
  type SafetyVerdict,
} from './policy';

type Db = Pick<PrismaService, 'action' | 'contact' | 'auditLog'>;

export interface SafetyCreationInput {
  /** Tenant: duplicates and caps are always computed within one workspace. */
  workspaceId: string;
  type: ActionType;
  payeeName: string;
  payeePaypal: string;
  amount: string | number;
  currency: string;
  purpose: string;
  dueDate?: Date | null;
  contact?: Contact | SafetyContact | null;
  sourceText?: string | null;
  extractedSignals?: string[] | null;
  batchId?: string | null;
  batchSize?: number;
  batchTotal?: number;
  /** Exclude an existing row (re-evaluation) from duplicate counting. */
  excludeActionId?: string;
}

export interface SafetyExecutionOptions {
  batchSize?: number;
  batchTotal?: number;
}

const COMMITTED_PAYOUT_STATUSES = [
  ActionStatus.EXECUTING,
  ActionStatus.EXECUTED,
];

const DUPLICATE_STATUSES = [
  ActionStatus.PENDING_APPROVAL,
  ActionStatus.APPROVED,
  ActionStatus.EXECUTING,
  ActionStatus.EXECUTED,
];

/**
 * DB-aware wrapper around the pure policy. Gate 1 calls evaluateCreation()
 * before an action exists; Gate 2 calls evaluateExecution() inside the
 * execution transaction. Both persist the same verdict shape.
 */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  policyConfig(): SafetyPolicyConfig {
    const number = (key: string, fallback: number): number => {
      const value = Number(this.config.get<string>(key));
      return Number.isFinite(value) ? value : fallback;
    };
    const list = (this.config.get<string>('SAFETY_CURRENCY_ALLOWLIST') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return {
      currencyAllowlist:
        list.length > 0 ? list : DEFAULT_SAFETY_POLICY.currencyAllowlist,
      autoApproveMaxAmount: number(
        'AUTO_APPROVE_MAX_AMOUNT',
        DEFAULT_SAFETY_POLICY.autoApproveMaxAmount,
      ),
      vendorDailyCap: number(
        'VENDOR_DAILY_CAP',
        DEFAULT_SAFETY_POLICY.vendorDailyCap,
      ),
      globalDailyCap: number(
        'GLOBAL_DAILY_CAP',
        DEFAULT_SAFETY_POLICY.globalDailyCap,
      ),
      invoiceMaxAmount: number(
        'INVOICE_MAX_AMOUNT',
        DEFAULT_SAFETY_POLICY.invoiceMaxAmount,
      ),
      batchMaxItems: number(
        'BATCH_MAX_ITEMS',
        DEFAULT_SAFETY_POLICY.batchMaxItems,
      ),
      batchMaxTotal: number(
        'BATCH_MAX_TOTAL',
        DEFAULT_SAFETY_POLICY.batchMaxTotal,
      ),
      duplicateWindowHours: number(
        'DUPLICATE_WINDOW_HOURS',
        DEFAULT_SAFETY_POLICY.duplicateWindowHours,
      ),
      amountAnomalyFactor: number(
        'AMOUNT_ANOMALY_FACTOR',
        DEFAULT_SAFETY_POLICY.amountAnomalyFactor,
      ),
      dueDateMaxDays: number(
        'DUE_DATE_MAX_DAYS',
        DEFAULT_SAFETY_POLICY.dueDateMaxDays,
      ),
    };
  }

  /**
   * Public, secret-free policy for the dashboard and /safety/policy. With a
   * workspace, the latest override row merges over the global config and the
   * stamp records which override evaluated (`base+w3`); without one, the
   * global policy. Old verdicts keep whatever stamp they were given.
   */
  async policy(workspaceId?: string) {
    const effective = workspaceId
      ? await this.effectiveConfig(workspaceId)
      : {
          config: this.policyConfig(),
          version: SAFETY_POLICY_VERSION,
          overrideVersion: null as number | null,
        };
    return {
      version: effective.version,
      codeVersion: SAFETY_POLICY_VERSION,
      overrideVersion: effective.overrideVersion,
      overridden: effective.overrideVersion !== null,
      config: effective.config,
      rules: POLICY_RULES,
    };
  }

  /** Latest override merged over global config; base stamp when none. */
  async effectiveConfig(workspaceId: string): Promise<{
    config: SafetyPolicyConfig;
    version: string;
    overrideVersion: number | null;
  }> {
    const global = this.policyConfig();
    const row = await this.prisma.safetyPolicy.findFirst({
      where: { workspaceId },
      orderBy: { version: 'desc' },
    });
    if (!row) {
      return {
        config: global,
        version: SAFETY_POLICY_VERSION,
        overrideVersion: null,
      };
    }
    const overrides = (row.config ?? {}) as Partial<SafetyPolicyConfig>;
    return {
      config: { ...global, ...overrides },
      version: `${SAFETY_POLICY_VERSION}+w${row.version}`,
      overrideVersion: row.version,
    };
  }

  /** Override history, newest first (empty until the workspace edits policy). */
  async listVersions(workspaceId: string) {
    return this.prisma.safetyPolicy.findMany({
      where: { workspaceId },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Save a new policy version: validated partial overrides become the
   * effective policy for FUTURE evaluations; past verdicts keep their stamp.
   */
  async saveVersion(
    workspaceId: string,
    input: unknown,
  ): Promise<{ version: number; config: SafetyPolicyConfig }> {
    const validated = this.validateOverrides(input);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latest = await this.prisma.safetyPolicy.findFirst({
        where: { workspaceId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      try {
        await this.prisma.safetyPolicy.create({
          data: { workspaceId, version, config: validated },
        });
        const effective = await this.effectiveConfig(workspaceId);
        return { version, config: effective.config };
      } catch (e) {
        if (
          attempt < 2 &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
    throw new Error('could not save policy version');
  }

  /** Reset to global defaults: drop every override row. */
  async resetVersions(workspaceId: string): Promise<{ reset: boolean }> {
    await this.prisma.safetyPolicy.deleteMany({ where: { workspaceId } });
    return { reset: true };
  }

  private validateOverrides(input: unknown): Record<string, number | string[]> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException(
        'policy body must be an object of overrides',
      );
    }
    const numbers = [
      'autoApproveMaxAmount',
      'vendorDailyCap',
      'globalDailyCap',
      'invoiceMaxAmount',
      'batchMaxItems',
      'batchMaxTotal',
      'duplicateWindowHours',
      'amountAnomalyFactor',
      'dueDateMaxDays',
    ];
    const out: Record<string, number | string[]> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === 'currencyAllowlist') {
        if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
          throw new BadRequestException(
            'policy.currencyAllowlist must be 1-20 currency codes',
          );
        }
        const codes = value.map((c) => String(c ?? '').trim().toUpperCase());
        if (!codes.every((c) => /^[A-Z]{3}$/.test(c))) {
          throw new BadRequestException(
            'policy.currencyAllowlist must be 3-letter codes',
          );
        }
        out.currencyAllowlist = [...new Set(codes)];
      } else if (numbers.includes(key)) {
        const n =
          typeof value === 'number'
            ? value
            : Number(String(value ?? '').trim());
        if (!Number.isFinite(n) || n < 0) {
          throw new BadRequestException(`policy.${key} must be a number >= 0`);
        }
        if (key === 'amountAnomalyFactor' && n <= 0) {
          throw new BadRequestException(
            'policy.amountAnomalyFactor must be > 0',
          );
        }
        out[key] = n;
      } else {
        throw new BadRequestException(`unknown policy key: ${key}`);
      }
    }
    if (Object.keys(out).length === 0) {
      throw new BadRequestException('policy body must set at least one key');
    }
    return out;
  }

  async evaluateCreation(input: SafetyCreationInput): Promise<SafetyVerdict> {
    const contact =
      input.contact ??
      (await this.findContact(
        input.payeeName,
        input.payeePaypal,
        this.prisma,
        input.workspaceId,
      ));
    const history = await this.historyFor(
      { ...input, contact, batchId: input.batchId },
      this.prisma,
      input.excludeActionId,
      { batchSize: input.batchSize, batchTotal: input.batchTotal },
    );
    const effective = await this.effectiveConfig(input.workspaceId);
    const verdict = evaluateSafety(
      {
        ...input,
        contact: contact as unknown as SafetyContact | null,
        history,
      },
      effective.config,
    );
    verdict.policyVersion = effective.version;
    return verdict;
  }

  /**
   * Gate 2. Called inside the execution transaction, after the approval hash
   * and version have been verified. The policy sees fresh aggregates so a
   * duplicate or cap consumed since approval still blocks.
   */
  async evaluateExecution(
    tx: Db,
    action: Action,
    options: SafetyExecutionOptions = {},
  ): Promise<SafetyVerdict> {
    const workspaceId = action.workspaceId;
    const contact = action.contactId
      ? await tx.contact.findUnique({ where: { id: action.contactId } })
      : await this.findContact(
          action.payeeName,
          action.payeePaypal,
          tx,
          workspaceId,
        );
    const history = await this.historyFor(
      {
        workspaceId,
        type: action.type,
        payeeName: action.payeeName,
        payeePaypal: action.payeePaypal,
        amount: action.amount.toString(),
        currency: action.currency,
        purpose: action.purpose,
        batchId: action.batchId,
        batchSize: options.batchSize,
        batchTotal: options.batchTotal,
      },
      tx,
      action.id,
      options,
    );
    // Gate 2: the tapper must be the action workspace's linked chat.
    // Read outside the narrowed txn client — link state needs no isolation.
    const actionLink = await this.prisma.telegramLink.findUnique({
      where: { workspaceId },
      select: { telegramId: true },
    });
    const approval: SafetyApproval = {
      expiresAt: action.expiresAt,
      approvedBy: action.approvedBy,
      expectedApprover: actionLink?.telegramId ?? null,
    };
    const effective = await this.effectiveConfig(workspaceId);
    const verdict = evaluateSafety(
      {
        type: action.type,
        payeeName: action.payeeName,
        payeePaypal: action.payeePaypal,
        amount: action.amount.toString(),
        currency: action.currency,
        purpose: action.purpose,
        dueDate: action.dueDate,
        contact: contact as unknown as SafetyContact | null,
        riskFlags: action.riskFlags,
        extractedSignals: [],
        history,
        approval,
      },
      effective.config,
    );
    verdict.policyVersion = effective.version;
    return verdict;
  }

  /** Persist the verdict in the action and append the immutable audit entry. */
  async recordGate(
    actionId: string,
    verdict: SafetyVerdict,
    gate: 1 | 2,
    detail: Record<string, unknown> = {},
    tx?: Db,
  ): Promise<void> {
    await this.audit.log(
      actionId,
      'SAFETY_EVALUATED',
      {
        gate,
        policyVersion: verdict.policyVersion,
        verdict: verdict.verdict,
        flags: verdict.flags,
        reasons: verdict.reasons,
        summary: verdict.summary,
        ...detail,
      },
      tx,
    );
  }

  /**
   * Mark an action unexecutable. Used after Gate 1 on creation and after a
   * Gate 2 refusal. Safe to call twice: the status filter makes it idempotent.
   */
  async block(
    actionId: string,
    verdict: SafetyVerdict,
    gate: 1 | 2,
    detail: Record<string, unknown> = {},
    tx?: Db,
  ): Promise<boolean> {
    const db = tx ?? this.prisma;
    const result = await db.action.updateMany({
      where: {
        id: actionId,
        status: {
          in: [
            ActionStatus.PENDING_APPROVAL,
            ActionStatus.APPROVED,
            ActionStatus.FAILED,
          ],
        },
      },
      data: {
        status: ActionStatus.BLOCKED,
        riskFlags: verdict.flags,
        policyVerdict: verdict.verdict,
        policyVersion: verdict.policyVersion,
        safetySummary: verdict.summary,
      },
    });
    if (result.count === 1) {
      await this.audit.log(
        actionId,
        'BLOCKED',
        {
          gate,
          policyVersion: verdict.policyVersion,
          verdict: verdict.verdict,
          flags: verdict.flags,
          reasons: verdict.reasons,
          summary: verdict.summary,
          noMoneyMoved: true,
          ...detail,
        },
        tx,
      );
      this.logger.warn(
        `action ${actionId} BLOCKED at gate ${gate}: ${verdict.summary}`,
      );
      return true;
    }
    return false;
  }

  async listBlocked(limit = 10, workspaceId?: string) {
    return this.prisma.action.findMany({
      where: {
        status: ActionStatus.BLOCKED,
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        type: true,
        status: true,
        payeeName: true,
        payeePaypal: true,
        amount: true,
        currency: true,
        purpose: true,
        riskFlags: true,
        policyVerdict: true,
        policyVersion: true,
        safetySummary: true,
        createdAt: true,
      },
    });
  }

  private async findContact(
    name: string,
    paypalEmail: string,
    db: Db = this.prisma,
    workspaceId?: string,
  ): Promise<Contact | null> {
    const tenant = workspaceId ? { workspaceId } : {};
    const byEmail = await db.contact.findFirst({
      where: {
        ...tenant,
        paypalEmail: { equals: paypalEmail, mode: 'insensitive' },
      },
    });
    if (byEmail) return byEmail;
    return db.contact.findFirst({
      where: {
        ...tenant,
        name: { equals: name.trim(), mode: 'insensitive' },
      },
    });
  }

  private async historyFor(
    input: SafetyCreationInput,
    db: Db,
    excludeActionId?: string,
    overrides: { batchSize?: number; batchTotal?: number } = {},
  ): Promise<SafetyHistory> {
    const config = (await this.effectiveConfig(input.workspaceId)).config;
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - config.duplicateWindowHours * 3_600_000,
    );
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);

    const duplicateCount = await db.action.count({
      where: {
        id: excludeActionId ? { not: excludeActionId } : undefined,
        workspaceId: input.workspaceId,
        payeePaypal: {
          equals: input.payeePaypal.trim(),
          mode: 'insensitive',
        },
        amount: input.amount,
        currency: input.currency.trim().toUpperCase(),
        status: { in: DUPLICATE_STATUSES },
        createdAt: { gte: cutoff },
      },
    });

    let vendorSpentToday = 0;
    let globalSpentToday = 0;
    if (input.type !== ActionType.INVOICE) {
      const baseWhere: Prisma.ActionWhereInput = {
        workspaceId: input.workspaceId,
        currency: input.currency.trim().toUpperCase(),
        status: { in: COMMITTED_PAYOUT_STATUSES },
        type: { in: [ActionType.PAYOUT_SINGLE, ActionType.PAYOUT_BATCH] },
        updatedAt: { gte: dayStart },
      };
      const [vendor, global] = await Promise.all([
        db.action.aggregate({
          _sum: { amount: true },
          where: {
            ...baseWhere,
            payeePaypal: {
              equals: input.payeePaypal.trim(),
              mode: 'insensitive',
            },
          },
        }),
        db.action.aggregate({ _sum: { amount: true }, where: baseWhere }),
      ]);
      vendorSpentToday = Number(vendor._sum.amount ?? 0);
      globalSpentToday = Number(global._sum.amount ?? 0);
    }

    let batchSize = overrides.batchSize;
    let batchTotal = overrides.batchTotal;
    if (input.type === ActionType.PAYOUT_BATCH && input.batchId) {
      const members = await db.action.findMany({
        where: { batchId: input.batchId, workspaceId: input.workspaceId },
        select: { amount: true },
      });
      batchSize = members.length;
      batchTotal = members.reduce(
        (sum, member) => sum + Number(member.amount),
        0,
      );
    }

    return {
      duplicateCount,
      vendorSpentToday,
      globalSpentToday,
      batchSize,
      batchTotal,
    };
  }
}
