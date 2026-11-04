import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AuditService } from './audit.service';

/**
 * Read-only audit trail. This is the same data Telegram `/trace` renders and
 * the dashboard shows; there is no write path from here.
 */
@Controller('audit')
@UseGuards(SessionAuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('recent')
  async recent(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('limit') limit?: string,
  ) {
    return this.audit.recent(Number(limit) || 25, workspace.id);
  }

  @Get('actions/:actionId')
  async trace(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('actionId') actionId: string,
  ) {
    return this.audit.trace(actionId, workspace.id);
  }
}
