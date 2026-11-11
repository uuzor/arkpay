import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ActionStatus, ActionType, Prisma } from '@prisma/client';
import type { Response } from 'express';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { csvDocument } from '../common/csv';
import { PaypalPayoutsService } from '../paypal/paypal-payouts.service';
import { PrismaService } from '../prisma/prisma.service';

interface BatchRollup {
  batchId: string;
  count: number;
  total: string;
  currency: string;
  createdAt: Date;
  paypalRef: string | null;
  statuses: Record<string, number>;
}

/**
 * Money-out ledger for the dashboard Payouts tab: single payouts plus batch
 * roll-ups. Batches are PAYOUT_BATCH member rows sharing a batchId; the
 * roll-up is computed here because per-status breakdowns need no extra query.
 */
@Controller('payouts')
@UseGuards(SessionAuthGuard)
export class PayoutsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: PaypalPayoutsService,
  ) {}

  @Get()
  async listSingles(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (
      status &&
      !Object.values(ActionStatus).includes(status as ActionStatus)
    ) {
      throw new BadRequestException(
        `invalid status: ${status} (want ${Object.values(ActionStatus).join(', ')})`,
      );
    }
    const take = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 100);
    const where: Prisma.ActionWhereInput = {
      workspaceId: workspace.id,
      type: ActionType.PAYOUT_SINGLE,
      ...(status ? { status: status as ActionStatus } : {}),
    };
    const rows = await this.prisma.action.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        payeeName: true,
        payeePaypal: true,
        amount: true,
        currency: true,
        purpose: true,
        paypalRef: true,
        riskFlags: true,
        policyVerdict: true,
        safetySummary: true,
        expiresAt: true,
        createdAt: true,
        contact: { select: { name: true } },
      },
    });
    const page = rows.slice(0, take);
    return {
      rows: page,
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
      totalCount: await this.prisma.action.count({ where }),
    };
  }

  @Get('batches')
  async listBatches(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
  ) {
    const members = await this.prisma.action.findMany({
      where: { workspaceId: workspace.id, type: ActionType.PAYOUT_BATCH },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        batchId: true,
        status: true,
        amount: true,
        currency: true,
        paypalRef: true,
        createdAt: true,
      },
    });
    const byBatch = new Map<string, BatchRollup & { totalCents: number }>();
    for (const member of members) {
      if (!member.batchId) continue;
      let rollup = byBatch.get(member.batchId);
      if (!rollup) {
        rollup = {
          batchId: member.batchId,
          count: 0,
          total: '0.00',
          currency: member.currency,
          createdAt: member.createdAt,
          paypalRef: null,
          statuses: {},
          totalCents: 0,
        };
        byBatch.set(member.batchId, rollup);
      }
      rollup.count += 1;
      rollup.totalCents += Math.round(Number(member.amount) * 100);
      rollup.statuses[member.status] =
        (rollup.statuses[member.status] ?? 0) + 1;
      if (member.createdAt < rollup.createdAt) {
        rollup.createdAt = member.createdAt;
      }
      if (!rollup.paypalRef && member.paypalRef) {
        rollup.paypalRef = member.paypalRef;
      }
    }
    const batches = [...byBatch.values()]
      .map(({ totalCents, ...rest }) => ({
        ...rest,
        total: (totalCents / 100).toFixed(2),
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { batches };
  }

  @Get('batches/:batchId')
  async batchDetail(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('batchId') batchId: string,
  ) {
    const members = await this.prisma.action.findMany({
      where: { workspaceId: workspace.id, batchId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        status: true,
        payeeName: true,
        payeePaypal: true,
        amount: true,
        currency: true,
        purpose: true,
        paypalRef: true,
        riskFlags: true,
        policyVerdict: true,
        createdAt: true,
      },
    });
    if (members.length === 0) {
      throw new NotFoundException(`payout batch ${batchId} not found`);
    }
    const totalCents = members.reduce(
      (sum, member) => sum + Math.round(Number(member.amount) * 100),
      0,
    );
    const statuses: Record<string, number> = {};
    for (const member of members) {
      statuses[member.status] = (statuses[member.status] ?? 0) + 1;
    }
    return {
      batchId,
      count: members.length,
      total: (totalCents / 100).toFixed(2),
      currency: members[0].currency,
      paypalRef: members.find((member) => member.paypalRef)?.paypalRef ?? null,
      statuses,
      members,
    };
  }

  /**
   * CSV export of single payouts for the dashboard Export button. Same
   * tenant scoping and status filter as the list; capped at 2000 newest
   * rows. Declared before `:id` so `export` matches here.
   */
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('status') status: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (
      status &&
      !Object.values(ActionStatus).includes(status as ActionStatus)
    ) {
      throw new BadRequestException(
        `invalid status: ${status} (want ${Object.values(ActionStatus).join(', ')})`,
      );
    }
    const rows = await this.prisma.action.findMany({
      where: {
        workspaceId: workspace.id,
        type: ActionType.PAYOUT_SINGLE,
        ...(status ? { status: status as ActionStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true,
        createdAt: true,
        status: true,
        payeeName: true,
        payeePaypal: true,
        amount: true,
        currency: true,
        purpose: true,
        paypalRef: true,
        policyVerdict: true,
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="arkpay-payouts-${day}.csv"`,
    );
    return csvDocument(
      [
        'id',
        'created_at',
        'status',
        'payee_name',
        'payee_paypal',
        'amount',
        'currency',
        'purpose',
        'paypal_ref',
        'policy_verdict',
      ],
      rows.map((r) => [
        r.id,
        r.createdAt,
        r.status,
        r.payeeName,
        r.payeePaypal,
        String(r.amount),
        r.currency,
        r.purpose,
        r.paypalRef,
        r.policyVerdict,
      ]),
    );
  }

  /**
   * Single-payout detail for the dashboard drawer. ArkPay's action row is
   * the source of truth; the live PayPal batch status merges in when the
   * payout executed, plus webhook history from the audit trail. Declared
   * last so the static `batches` routes match first.
   */
  @Get(':id')
  async singleDetail(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    const action = await this.prisma.action.findFirst({
      where: {
        id,
        type: ActionType.PAYOUT_SINGLE,
        workspaceId: workspace.id,
      },
      include: {
        email: { select: { from: true, subject: true } },
        contact: { select: { id: true, name: true } },
      },
    });
    if (!action) throw new NotFoundException(`payout action ${id} not found`);
    const paypal = action.paypalRef
      ? await this.payouts
          .getPayoutBatch(action.paypalRef, workspace.id)
          .then((batch) => ({
            available: true as const,
            id: batch.payoutBatchId,
            status: batch.batchStatus,
          }))
          .catch((e: unknown) => ({
            available: false as const,
            reason: e instanceof Error ? e.message : String(e),
          }))
      : { available: false as const, reason: 'not sent to PayPal yet' };
    const webhookEvents = await this.prisma.auditLog.findMany({
      where: { actionId: id, event: { startsWith: 'WEBHOOK_' } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { action, paypal, webhookEvents };
  }
}
