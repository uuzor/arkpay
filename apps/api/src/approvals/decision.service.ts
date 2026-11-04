import { Injectable } from '@nestjs/common';
import { ActionStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { WorkspacesService } from '../auth/workspaces.service';
import { PrismaService } from '../prisma/prisma.service';

export type DecisionVerb = 'approve' | 'ignore';

export interface DecisionResult {
  ok: boolean;
  reason:
    | 'approved'
    | 'ignored'
    | 'already_handled'
    | 'expired'
    | 'forbidden'
    | 'not_found';
  status?: ActionStatus;
}

/**
 * Approval state machine for Telegram taps. Every transition is a single
 * UPDATE-WHERE on PENDING_APPROVAL + unexpired, so a double-tap (or two
 * workers) can never both win. Audit rows are written in the same transaction.
 */
@Injectable()
export class DecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * The tapper's linked workspace, or null for unknown/anonymous tappers.
   * Identity is the pairing link — there is no global approver id.
   */
  private async tapperWorkspace(
    userId: string | number | undefined,
  ): Promise<string | null> {
    if (userId === undefined) return null;
    return this.workspaces.resolveForTelegram(userId);
  }

  async decide(
    actionId: string,
    verb: DecisionVerb,
    userId: string | number | undefined,
  ): Promise<DecisionResult> {
    const tapper = await this.tapperWorkspace(userId);
    if (!tapper) {
      return { ok: false, reason: 'forbidden' };
    }
    return this.decideAs(actionId, verb, {
      workspaceId: tapper,
      via: 'telegram',
      by: String(userId),
    });
  }

  /**
   * Session-authorized twin of decide(): the dashboard proves the tenant
   * with its session instead of a pairing link. Same status machine, same
   * expiry races, same audit shape.
   */
  async decideViaSession(
    actionId: string,
    verb: DecisionVerb,
    workspaceId: string,
    by: string,
  ): Promise<DecisionResult> {
    return this.decideAs(actionId, verb, { workspaceId, via: 'dashboard', by });
  }

  private async decideAs(
    actionId: string,
    verb: DecisionVerb,
    ctx: { workspaceId: string; via: string; by: string },
  ): Promise<DecisionResult> {
    const action = await this.prisma.action.findUnique({
      where: { id: actionId },
    });
    if (!action) return { ok: false, reason: 'not_found' };
    // Cross-tenant decisions see not_found (no existence leak); the money gate.
    if (action.workspaceId !== ctx.workspaceId) {
      return { ok: false, reason: 'not_found' };
    }
    if (action.status !== ActionStatus.PENDING_APPROVAL) {
      return {
        ok: false,
        reason: 'already_handled',
        status: action.status,
      };
    }

    const now = new Date();
    if (action.expiresAt.getTime() <= now.getTime()) {
      await this.prisma.$transaction(async (tx) => {
        const result = await tx.action.updateMany({
          where: { id: actionId, status: ActionStatus.PENDING_APPROVAL },
          data: { status: ActionStatus.EXPIRED },
        });
        if (result.count === 1) {
          await this.audit.log(
            actionId,
            'EXPIRED',
            { via: ctx.via, userId: ctx.by },
            tx,
          );
        }
      });
      return { ok: false, reason: 'expired', status: ActionStatus.EXPIRED };
    }

    const next =
      verb === 'approve' ? ActionStatus.APPROVED : ActionStatus.IGNORED;
    const changed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.action.updateMany({
        where: {
          id: actionId,
          status: ActionStatus.PENDING_APPROVAL,
          expiresAt: { gt: now },
        },
        data: {
          status: next,
          approvedBy: ctx.by,
          approvedAt: now,
        },
      });
      if (result.count === 1) {
        await this.audit.log(
          actionId,
          next,
          {
            via: ctx.via,
            userId: ctx.by,
            version: action.version,
          },
          tx,
        );
      }
      return result.count;
    });

    if (changed === 1) {
      return {
        ok: true,
        reason: verb === 'approve' ? 'approved' : 'ignored',
        status: next,
      };
    }

    const latest = await this.prisma.action.findUnique({
      where: { id: actionId },
      select: { status: true },
    });
    if (!latest) return { ok: false, reason: 'not_found' };
    if (latest.status === ActionStatus.PENDING_APPROVAL) {
      // Lost the expiry race between the initial read and the update.
      return { ok: false, reason: 'expired', status: latest.status };
    }
    return { ok: false, reason: 'already_handled', status: latest.status };
  }

  /**
   * Batch twin of decide(): every member verified, then ALL flipped in one
   * UPDATE-WHERE expecting the full member count — one lost race voids the
   * whole batch decision instead of approving half a payroll.
   */
  async decideBatch(
    batchId: string,
    verb: DecisionVerb,
    userId: string | number | undefined,
  ): Promise<DecisionResult> {
    const tapper = await this.tapperWorkspace(userId);
    if (!tapper) {
      return { ok: false, reason: 'forbidden' };
    }
    const members = await this.prisma.action.findMany({
      where: { batchId },
      orderBy: { createdAt: 'asc' },
    });
    if (members.length === 0) return { ok: false, reason: 'not_found' };
    const undecided = members.filter(
      (m) => m.status !== ActionStatus.PENDING_APPROVAL,
    );
    if (undecided.length > 0) {
      return {
        ok: false,
        reason: 'already_handled',
        status: undecided[0].status,
      };
    }
    if (members.some((m) => m.workspaceId !== tapper)) {
      return { ok: false, reason: 'not_found' };
    }
    const now = new Date();
    if (members.some((m) => m.expiresAt.getTime() <= now.getTime())) {
      await this.prisma.$transaction(async (tx) => {
        await tx.action.updateMany({
          where: { batchId, status: ActionStatus.PENDING_APPROVAL },
          data: { status: ActionStatus.EXPIRED },
        });
        for (const m of members) {
          await this.audit.log(
            m.id,
            'EXPIRED',
            { via: 'telegram', batchId, userId: String(userId) },
            tx,
          );
        }
      });
      return { ok: false, reason: 'expired', status: ActionStatus.EXPIRED };
    }

    const next =
      verb === 'approve' ? ActionStatus.APPROVED : ActionStatus.IGNORED;
    const changed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.action.updateMany({
        where: {
          batchId,
          status: ActionStatus.PENDING_APPROVAL,
          expiresAt: { gt: now },
        },
        data: {
          status: next,
          approvedBy: String(userId),
          approvedAt: now,
        },
      });
      if (result.count === members.length) {
        for (const m of members) {
          await this.audit.log(
            m.id,
            next,
            {
              via: 'telegram',
              batchId,
              userId: String(userId),
              version: m.version,
            },
            tx,
          );
        }
      }
      return result.count;
    });
    if (changed === members.length) {
      return {
        ok: true,
        reason: verb === 'approve' ? 'approved' : 'ignored',
        status: next,
      };
    }
    return { ok: false, reason: 'already_handled' };
  }

  /**
   * Retire up to `limit` PENDING approvals past expiry. Batch members retire
   * individually; batch atomicity is still enforced at decision/execution
   * time (a mixed batch refuses as a whole).
   */
  async expireStale(limit = 25): Promise<string[]> {
    const stale = await this.prisma.action.findMany({
      where: {
        status: ActionStatus.PENDING_APPROVAL,
        expiresAt: { lte: new Date() },
      },
      select: { id: true },
      take: Math.min(Math.max(limit, 1), 100),
    });
    const expired: string[] = [];
    for (const row of stale) {
      const result = await this.prisma.action.updateMany({
        where: { id: row.id, status: ActionStatus.PENDING_APPROVAL },
        data: { status: ActionStatus.EXPIRED },
      });
      if (result.count === 1) {
        await this.audit.log(row.id, 'EXPIRED', { via: 'sweep' });
        expired.push(row.id);
      }
    }
    return expired;
  }

  listPending(limit = 10, workspaceId?: string) {
    return this.prisma.action.findMany({
      where: {
        status: ActionStatus.PENDING_APPROVAL,
        expiresAt: { gt: new Date() },
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 25),
      include: {
        email: { select: { from: true, subject: true } },
      },
    });
  }
}
