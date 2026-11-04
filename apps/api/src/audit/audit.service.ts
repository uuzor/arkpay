import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Anything with an auditLog delegate: PrismaService or a $transaction client. */
type AuditWriter = Pick<PrismaService, 'auditLog'>;

/**
 * Single writer for the audit trail. Accepts an optional transaction client
 * so state flips and their audit rows commit atomically.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    actionId: string,
    event: string,
    detail?: Prisma.InputJsonValue,
    tx?: AuditWriter,
  ) {
    return (tx ?? this.prisma).auditLog.create({
      data: { actionId, event, detail },
    });
  }

  /** Newest actions for the dashboard activity feed. */
  recent(limit = 25, workspaceId?: string) {
    return this.prisma.action.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
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
        paypalRef: true,
        createdAt: true,
        updatedAt: true,
        audit: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { event: true, detail: true, createdAt: true },
        },
      },
    });
  }

  /**
   * The full trace for one action: raw email, model proposal, contact, policy
   * verdict, approval and every execution/webhook event, oldest first.
   */
  trace(actionId: string, workspaceId?: string) {
    return this.prisma.action.findFirst({
      where: { id: actionId, ...(workspaceId ? { workspaceId } : {}) },
      include: {
        email: true,
        contact: true,
        audit: { orderBy: { createdAt: 'asc' } },
      },
    });
  }
}
