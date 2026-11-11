import { Controller, Get, UseGuards } from '@nestjs/common';
import { ActionStatus, ActionType } from '@prisma/client';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

interface MoneyMap {
  [currency: string]: string;
}

export interface OverdueRow {
  id: string;
  payeeName: string;
  amount: string;
  currency: string;
  daysOverdue: number;
  reminders: number;
  paypalRef: string | null;
}

/**
 * Personal-finance aggregates for the dashboard overview, computed
 * server-side (the browser never sums money). Received = SENT invoices
 * with a WEBHOOK_PAID audit; outstanding = SENT without one; overdue adds
 * a past due date. Paid out = executed payouts, singles and batch members.
 */
@Controller('overview')
@UseGuards(SessionAuthGuard)
export class OverviewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('finance')
  async finance(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    const now = new Date();
    const [invoices, payouts, audits] = await Promise.all([
      this.prisma.action.findMany({
        where: {
          workspaceId: workspace.id,
          type: ActionType.INVOICE,
          status: ActionStatus.EXECUTED,
        },
        select: {
          id: true,
          payeeName: true,
          amount: true,
          currency: true,
          dueDate: true,
          paypalRef: true,
        },
      }),
      this.prisma.action.findMany({
        where: {
          workspaceId: workspace.id,
          type: { in: [ActionType.PAYOUT_SINGLE, ActionType.PAYOUT_BATCH] },
          status: ActionStatus.EXECUTED,
        },
        select: { amount: true, currency: true },
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: { workspaceId: workspace.id, type: ActionType.INVOICE },
          event: { in: ['WEBHOOK_PAID', 'REMINDER_SENT'] },
        },
        select: { actionId: true, event: true },
      }),
    ]);

    const paidIds = new Set(
      audits.filter((a) => a.event === 'WEBHOOK_PAID').map((a) => a.actionId),
    );
    const reminderCounts = new Map<string, number>();
    for (const a of audits) {
      if (a.event === 'REMINDER_SENT') {
        reminderCounts.set(a.actionId, (reminderCounts.get(a.actionId) ?? 0) + 1);
      }
    }

    // Integer cents throughout; Decimal strings convert exactly.
    const sumCents = (rows: Array<{ amount: unknown; currency: string }>) => {
      const totals = new Map<string, number>();
      for (const r of rows) {
        const cents = Math.round(Number(r.amount) * 100);
        if (Number.isFinite(cents)) {
          totals.set(r.currency, (totals.get(r.currency) ?? 0) + cents);
        }
      }
      return totals;
    };
    const toMoney = (totals: Map<string, number>): MoneyMap =>
      Object.fromEntries(
        [...totals.entries()].map(([currency, cents]) => [
          currency,
          (cents / 100).toFixed(2),
        ]),
      );

    const receivedRows = invoices.filter((i) => paidIds.has(i.id));
    const outstandingRows = invoices.filter((i) => !paidIds.has(i.id));
    const allOverdue: OverdueRow[] = outstandingRows
      .filter((i) => i.dueDate && i.dueDate.getTime() < now.getTime())
      .map((i) => ({
        id: i.id,
        payeeName: i.payeeName,
        amount: String(i.amount),
        currency: i.currency,
        daysOverdue: Math.max(
          0,
          Math.floor(
            (now.getTime() - (i.dueDate as Date).getTime()) / 86_400_000,
          ),
        ),
        reminders: reminderCounts.get(i.id) ?? 0,
        paypalRef: i.paypalRef,
      }))
      .filter((r) => r.daysOverdue > 0)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    return {
      received: toMoney(sumCents(receivedRows)),
      receivedCount: receivedRows.length,
      paidOut: toMoney(sumCents(payouts)),
      paidOutCount: payouts.length,
      outstanding: toMoney(sumCents(outstandingRows)),
      outstandingCount: outstandingRows.length,
      overdueTotal: toMoney(sumCents(allOverdue)),
      overdue: allOverdue.slice(0, 8),
      overdueCount: allOverdue.length,
    };
  }
}
