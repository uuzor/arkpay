import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ScheduleStatus } from '@prisma/client';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  SchedulerService,
  type ScheduleInput,
  type ScheduleUpdate,
} from './scheduler.service';

@Controller('schedules')
@UseGuards(SessionAuthGuard)
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Get()
  async list(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('limit') limit?: string,
  ) {
    return this.scheduler.list(Number(limit) || 25, workspace.id);
  }

  @Get(':id')
  async get(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    return this.scheduler.get(id, workspace.id);
  }

  @Get(':id/runs')
  async runs(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.scheduler.runs(id, Number(limit) || 25, workspace.id);
  }

  @Post()
  async create(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body() body: ScheduleInput,
  ) {
    this.validate(body, true);
    return this.scheduler.create(body, workspace.id);
  }

  @Patch(':id')
  async update(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
    @Body() body: ScheduleUpdate,
  ) {
    this.validate(body, false);
    return this.scheduler.update(id, body, workspace.id);
  }

  @Post(':id/run')
  async runNow(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    return this.scheduler.runNow(id, workspace.id);
  }

  private validate(
    input: Partial<ScheduleInput>,
    requireIdentity: boolean,
  ): void {
    if (requireIdentity) {
      if (!input.title?.trim()) {
        throw new BadRequestException('title is required');
      }
      if (!input.detail?.trim()) {
        throw new BadRequestException('detail is required');
      }
      if (!input.kind?.trim()) {
        throw new BadRequestException('kind is required');
      }
    } else {
      if (input.title !== undefined && !input.title.trim()) {
        throw new BadRequestException('title cannot be empty');
      }
      if (input.detail !== undefined && !input.detail.trim()) {
        throw new BadRequestException('detail cannot be empty');
      }
      if (input.kind !== undefined && !input.kind.trim()) {
        throw new BadRequestException('kind cannot be empty');
      }
    }
    if (input.trigger && !['ONCE', 'INTERVAL', 'CRON'].includes(input.trigger)) {
      throw new BadRequestException('trigger must be ONCE, INTERVAL or CRON');
    }
    if (input.trigger === 'CRON' && !input.cron?.trim()) {
      throw new BadRequestException('cron is required for CRON schedules');
    }
    if (
      input.trigger === 'INTERVAL' &&
      (!input.intervalMinutes || input.intervalMinutes <= 0)
    ) {
      throw new BadRequestException(
        'intervalMinutes must be positive for INTERVAL schedules',
      );
    }
    if (input.trigger === 'ONCE' && !input.runAt) {
      throw new BadRequestException('runAt is required for ONCE schedules');
    }
    if (input.status && !Object.values(ScheduleStatus).includes(input.status)) {
      throw new BadRequestException('invalid schedule status');
    }
  }
}
