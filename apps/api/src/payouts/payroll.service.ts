import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ActionStatus, type PayrollRun } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  PayoutsService,
  type AssembledBatch,
} from './payouts.service';
import { isValidPeriod } from './payroll-period';

export interface PreparePayrollOptions {
  preparedBy?: string;
  note?: string;
  /** Tenant; required, no fallback. */
  workspaceId: string;
}

export interface PayrollPreparation {
  created: boolean;
  run: PayrollRun;
  batch?: AssembledBatch;
}

/**
 * Monthly payroll domain record. The generic scheduler only decides WHEN to
 * call this; PayrollRun.period + the advisory lock make the preparation
 * itself idempotent even if a manual run and a scheduled run overlap.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
  ) {}

  async prepare(
    period: string,
    options: PreparePayrollOptions,
  ): Promise<PayrollPreparation> {
    if (!isValidPeriod(period)) {
      throw new BadRequestException(`invalid payroll period: ${period}`);
    }
    const preparedBy = options.preparedBy?.trim() || 'scheduler';
    const workspaceId = options.workspaceId;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arkpay:payroll:${workspaceId}:${period}`}))`;
      const existing = await tx.payrollRun.findUnique({
        where: { workspaceId_period: { workspaceId, period } },
      });
      if (existing) return { created: false, run: existing };

      const batchId = randomUUID();
      const assembled = await this.payouts.assembleTeamBatch(
        {},
        {
          tx,
          batchId,
          purpose: options.note?.trim() || `Payroll ${period}`,
          workspaceId,
        },
      );
      const run = await tx.payrollRun.create({
        data: {
          workspaceId,
          period,
          status: ActionStatus.PENDING_APPROVAL,
          batchId,
          totalAmount: assembled.total,
          currency: assembled.currency,
          preparedBy,
          note: options.note?.trim() || null,
        },
      });
      this.logger.log(
        `payroll ${period} prepared by ${preparedBy}: ${assembled.included.length} recipients, ${assembled.currency} ${assembled.total}`,
      );
      return { created: true, run, batch: assembled };
    });
  }

  list(limit = 12, workspaceId?: string) {
    return this.prisma.payrollRun.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: { period: 'desc' },
      take: Math.min(Math.max(limit, 1), 36),
    });
  }

  async detail(period: string, workspaceId: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { workspaceId_period: { workspaceId, period } },
    });
    if (!run) return null;
    const members = await this.prisma.action.findMany({
      where: { batchId: run.batchId },
      orderBy: { createdAt: 'asc' },
      include: { contact: true },
    });
    return { run, members };
  }
}
