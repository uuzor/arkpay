import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Schedule, ScheduleRun } from '@prisma/client';
import { AgentService } from '../agent/agent.service';
import { PayrollService } from '../payouts/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { periodForOccurrence } from '../payouts/payroll-period';
import { InvoiceFollowupService } from '../telegram/invoice-followup.service';
import { TelegramService } from '../telegram/telegram.service';

export interface ScheduleHandlerResult {
  summary: string;
  [key: string]: unknown;
}

/**
 * The only place a Schedule.kind becomes executable code. Adding a new
 * schedulable thing means adding a case here (or a generic kind such as
 * NOTIFY/AGENT_TASK); the runner itself never changes.
 */
@Injectable()
export class ScheduleHandlers {
  private readonly logger = new Logger(ScheduleHandlers.name);

  constructor(
    private readonly payroll: PayrollService,
    private readonly followups: InvoiceFollowupService,
    private readonly telegram: TelegramService,
    // Cycle with TelegramModule (agent schedule tools need SchedulerService)
    // is request-time safe via forwardRef on both modules.
    @Inject(forwardRef(() => AgentService))
    private readonly agent: AgentService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async dispatch(
    schedule: Schedule,
    run: ScheduleRun,
  ): Promise<ScheduleHandlerResult> {
    const payload = (schedule.payload ?? {}) as Record<string, unknown>;
    switch (schedule.kind) {
      case 'PAYROLL_PREPARE': {
        const offset = Number(payload.periodOffsetMonths ?? 0);
        const period = periodForOccurrence(
          run.scheduledFor,
          schedule.timezone,
          Number.isFinite(offset) ? offset : 0,
        );
        const prepared = await this.payroll.prepare(period, {
          preparedBy: 'scheduler',
          note:
            typeof payload.purpose === 'string'
              ? payload.purpose
              : `Payroll ${period}`,
          workspaceId: schedule.workspaceId,
        });
        if (!prepared.created || !prepared.batch) {
          return {
            summary: `Payroll ${period} already prepared`,
            period,
            payrollRunId: prepared.run.id,
            batchId: prepared.run.batchId,
            alreadyPrepared: true,
          };
        }
        await this.telegram.sendBatchCard(
          prepared.batch.batchId,
          prepared.batch.excluded,
        );
        return {
          summary: `Prepared payroll ${period}: ${prepared.batch.included.length} recipients, ${prepared.batch.currency} ${prepared.batch.total}`,
          period,
          payrollRunId: prepared.run.id,
          batchId: prepared.batch.batchId,
          total: prepared.batch.total,
          included: prepared.batch.included.length,
          excluded: prepared.batch.excluded.length,
          cardSent: true,
        };
      }

      case 'INVOICE_REMINDERS': {
        const result = await this.followups.runOnce(schedule.workspaceId);
        return {
          summary: `Checked ${result.checked} invoices, sent ${result.reminded} reminders, skipped ${result.skipped}`,
          ...result,
        };
      }

      case 'NOTIFY': {
        const text =
          typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) throw new Error('NOTIFY payload.text is required');
        await this.telegram.sendMessage(text, schedule.workspaceId);
        return { summary: 'Notification sent' };
      }

      case 'AGENT_TASK': {
        const prompt = schedule.detail.trim();
        if (!prompt) throw new Error('AGENT_TASK detail is required');
        let rawUserId = payload.userId;
        if (
          (rawUserId === undefined || rawUserId === null) &&
          schedule.workspaceId
        ) {
          const link = await this.prisma.telegramLink.findUnique({
            where: { workspaceId: schedule.workspaceId },
            select: { telegramId: true },
          });
          rawUserId = link?.telegramId;
        }
        const configured = Number(rawUserId);
        if (!Number.isFinite(configured)) {
          throw new Error(
            'AGENT_TASK needs payload.userId or a linked Telegram chat',
          );
        }
        const reply = await this.agent.runScheduled(
          configured,
          prompt,
          schedule.workspaceId,
        );
        if (reply.document) {
          await this.telegram.sendDocument(
            reply.document.buffer,
            reply.document.filename,
            reply.document.caption,
            schedule.workspaceId,
          );
        }
        if (reply.text)
          await this.telegram.sendMessage(
            reply.text.slice(0, 4096),
            schedule.workspaceId,
          );
        return { summary: 'Agent task completed', replied: Boolean(reply.text) };
      }

      case 'NOOP':
        return { summary: 'No-op schedule executed' };

      default:
        throw new Error(`no handler registered for kind ${schedule.kind}`);
    }
  }
}
