import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PayrollService } from '../payouts/payroll.service';
import { isValidPeriod, periodInTimezone } from '../payouts/payroll-period';
import { TelegramService } from './telegram.service';

@Controller('payroll')
@UseGuards(SessionAuthGuard)
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.payroll.list(12, workspace.id);
  }

  @Get(':period')
  async detail(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('period') period: string,
  ) {
    return this.payroll.detail(period, workspace.id);
  }

  @Post('prepare')
  async prepare(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body() body: { period?: string; note?: string },
  ) {
    const period =
      body.period?.trim() ||
      periodInTimezone(
        new Date(),
        this.config.get<string>('PAYROLL_TIMEZONE') ?? 'UTC',
      );
    if (!isValidPeriod(period)) {
      throw new BadRequestException(`invalid payroll period: ${period}`);
    }
    const prepared = await this.payroll.prepare(period, {
      preparedBy: 'manual',
      note: body.note,
      workspaceId: workspace.id,
    });
    let cardMessageId: number | null = null;
    if (prepared.created && prepared.batch) {
      cardMessageId = await this.telegram.sendBatchCard(
        prepared.batch.batchId,
        prepared.batch.excluded,
      );
    }
    return {
      created: prepared.created,
      period,
      run: prepared.run,
      batch: prepared.batch ?? null,
      cardMessageId,
    };
  }

  @Post(':period/resend-card')
  async resend(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('period') period: string,
  ) {
    const detail = await this.payroll.detail(period, workspace.id);
    if (!detail) throw new BadRequestException(`no payroll run for ${period}`);
    const messageId = await this.telegram.sendBatchCard(detail.run.batchId, []);
    return { period, messageId };
  }
}
