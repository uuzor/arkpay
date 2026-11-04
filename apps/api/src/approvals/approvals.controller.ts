import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ActionStatus, ActionType, Prisma } from '@prisma/client';
import {
  CurrentUser,
  CurrentWorkspace,
} from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApprovalsService,
  type SupersedeChanges,
} from './approvals.service';
import { DecisionService } from './decision.service';

interface SupersedeBody extends SupersedeChanges {
  /** Who requested the edit (audit only). */
  by?: string;
}

/**
 * Session-guarded execution surface: run an approval, revise one (voiding
 * it), or reconcile stuck rows.
 *
 * Note: supersede returns the new action id but does NOT send its Telegram
 * card (that would need telegram → approvals → telegram). Run /pending in the
 * bot to re-list open cards after a supersede.
 */
@Controller('approvals')
@UseGuards(SessionAuthGuard)
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly prisma: PrismaService,
    private readonly decision: DecisionService,
  ) {}

  /**
   * Money queue for the dashboard Approvals tab. Pending-first: Postgres
   * sorts the native status enum in schema-definition order, which starts
   * with PENDING_APPROVAL. Cursor is an action id from a previous page.
   */
  @Get()
  async list(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('status') status?: string,
    @Query('type') type?: string,
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
    if (type && !Object.values(ActionType).includes(type as ActionType)) {
      throw new BadRequestException(
        `invalid type: ${type} (want ${Object.values(ActionType).join(', ')})`,
      );
    }
    const take = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 100);
    const where: Prisma.ActionWhereInput = {
      workspaceId: workspace.id,
      ...(status ? { status: status as ActionStatus } : {}),
      ...(type ? { type: type as ActionType } : {}),
    };
    const rows = await this.prisma.action.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
        safetySummary: true,
        paypalRef: true,
        expiresAt: true,
        createdAt: true,
        email: { select: { from: true, subject: true } },
        contact: { select: { name: true } },
      },
    });
    const page = rows.slice(0, take);
    return {
      rows: page,
      nextCursor:
        rows.length > take ? page[page.length - 1].id : null,
      totalCount: await this.prisma.action.count({ where }),
    };
  }

  @Post('reconcile')
  reconcile() {
    return this.approvals.reconcileStaleExecuting();
  }

  @Post(':id/execute')
  async execute(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    return this.approvals.executeApprovedAction(id, workspace.id);
  }

  @Post('batch/:batchId/execute')
  async executeBatch(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('batchId') batchId: string,
  ) {
    return this.approvals.executeBatch(batchId, workspace.id);
  }

  /**
   * Dashboard twin of the Telegram Ignore button: dismiss a pending action.
   * Same status machine as taps (expiry races, audit); approval from the
   * dashboard stays deliberately unavailable — taps happen in Telegram.
   */
  @Post(':id/ignore')
  async ignore(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @CurrentUser() user: RequestSession['user'],
    @Param('id') id: string,
  ) {
    return this.decision.decideViaSession(id, 'ignore', workspace.id, user.id);
  }

  @Post(':id/supersede')
  async supersede(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
    @Body() body: SupersedeBody,
  ) {
    const { by, ...changes } = body ?? {};
    return this.approvals.supersede(
      id,
      changes,
      by?.trim() || 'api',
      workspace.id,
    );
  }
}
