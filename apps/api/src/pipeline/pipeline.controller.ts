import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PipelineService } from './pipeline.service';

/**
 * Manual pipeline surface. The server tick runs this automatically; these
 * endpoints are for demos, backfills, and debugging.
 */
@Controller('pipeline')
@UseGuards(SessionAuthGuard)
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Post('run')
  async run(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body() body: { limit?: number },
  ) {
    return this.pipeline.processNewEmails(body?.limit ?? 5, workspace.id);
  }

  @Get('status')
  async status(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.pipeline.status(workspace.id);
  }
}
