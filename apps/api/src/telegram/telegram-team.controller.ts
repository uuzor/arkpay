import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { RequestSession } from '../auth/session.service';
import '../auth/tenant-request';
import { WorkspacesService } from '../auth/workspaces.service';
import {
  PayoutsService,
  type AssembleTeamBatchInput,
} from '../payouts/payouts.service';
import { TelegramService } from './telegram.service';

/**
 * HTTP twin of the "pay my team" Telegram command: assemble the STAFF batch
 * and send its approval card. Plus the pairing-code minter.
 */
@Controller('telegram')
@UseGuards(SessionAuthGuard)
export class TelegramTeamController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly telegram: TelegramService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Mint (or re-show) this workspace's Telegram pairing code. */
  @Post('link-code')
  @HttpCode(200)
  linkCode(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.workspaces.issueLinkCode(workspace.id);
  }

  @Post('team-payout')
  async teamPayout(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body() body: AssembleTeamBatchInput,
  ) {
    const result = await this.payouts.assembleTeamBatch(body ?? {}, {
      workspaceId: workspace.id,
    });
    const messageId = await this.telegram.sendBatchCard(
      result.batchId,
      result.excluded,
    );
    return { ...result, messageId };
  }
}
