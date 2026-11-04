import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionStatus, ActionType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PaypalInvoicesService } from '../paypal/paypal-invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

const DEFAULT_DAYS = [3, 7, 14];

/**
 * Automatic payment follow-ups, invoked by the generic scheduler's
 * INVOICE_REMINDERS handler. For each executed invoice it checks PayPal,
 * skips paid invoices, and sends one reminder at the highest due stage that
 * hasn't fired yet.
 */
@Injectable()
export class InvoiceFollowupService {
  private readonly logger = new Logger(InvoiceFollowupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly invoices: PaypalInvoicesService,
    private readonly telegram: TelegramService,
    private readonly audit: AuditService,
  ) {}

  private stages(): number[] {
    const raw = this.config.get<string>('FOLLOWUP_DAYS') ?? '';
    const parsed = raw
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    return parsed.length ? parsed : DEFAULT_DAYS;
  }

  async runOnce(workspaceId?: string): Promise<{
    checked: number;
    reminded: number;
    skipped: number;
  }> {
    const counts = { checked: 0, reminded: 0, skipped: 0 };
    const stages = this.stages();
    const actions = await this.prisma.action.findMany({
      where: {
        type: ActionType.INVOICE,
        status: ActionStatus.EXECUTED,
        paypalRef: { not: null },
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });

    for (const action of actions) {
      counts.checked += 1;
      try {
        const executed = await this.prisma.auditLog.findFirst({
          where: { actionId: action.id, event: 'EXECUTED' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        const anchor = executed?.createdAt ?? action.updatedAt;
        const days = Math.floor(
          (Date.now() - anchor.getTime()) / 86_400_000,
        );
        const due = stages.filter((s) => days >= s).pop();
        if (!due) {
          counts.skipped += 1;
          continue;
        }

        const sent = await this.prisma.auditLog.findMany({
          where: { actionId: action.id, event: 'REMINDER_SENT' },
          select: { detail: true },
        });
        const already = sent.some(
          (row) =>
            (row.detail as { stage?: number } | null)?.stage === due,
        );
        if (already) {
          counts.skipped += 1;
          continue;
        }

        const invoice = await this.invoices.getInvoice(
          action.paypalRef!,
          action.workspaceId,
        );
        const status = invoice.status.toUpperCase();
        if (['PAID', 'CANCELLED', 'REFUNDED'].includes(status)) {
          counts.skipped += 1;
          continue;
        }

        await this.invoices.remindInvoice(
          action.paypalRef!,
          action.workspaceId,
          `Friendly reminder: invoice ${action.paypalRef} for ${action.currency} ${Number(action.amount).toFixed(2)} is still open.`,
        );
        await this.audit.log(action.id, 'REMINDER_SENT', {
          stage: due,
          day: days,
          paypalRef: action.paypalRef,
          via: 'scheduler',
        });
        await this.telegram.sendActionMessage(
          action.id,
          `📨 Followed up on ${action.payeeName} · ${action.paypalRef} (day ${days}, stage ${due})`,
        );
        counts.reminded += 1;
      } catch (e) {
        this.logger.warn(
          `follow-up skipped for ${action.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
        counts.skipped += 1;
      }
    }
    return counts;
  }
}
