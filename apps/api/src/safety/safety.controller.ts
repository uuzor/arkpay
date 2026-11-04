import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SafetyService } from './safety.service';

/**
 * Read-only safety surface for the dashboard and demo. No secrets, no action
 * creation — the engine is enforced by the pipeline and execution service.
 */
@Controller('safety')
@UseGuards(SessionAuthGuard)
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Get('policy')
  policy(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.safety.policy(workspace.id);
  }

  /** Override history, newest first. */
  @Get('policies')
  versions(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.safety.listVersions(workspace.id);
  }

  /**
   * Save a new policy version: a partial object of overrides that becomes
   * effective for future evaluations. Past verdicts keep their stamp.
   */
  @Post('policies')
  saveVersion(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body() body: unknown,
  ) {
    return this.safety.saveVersion(workspace.id, body);
  }

  /** Reset to global defaults (drops every override row). */
  @Delete('policies')
  reset(@CurrentWorkspace() workspace: RequestSession['workspace']) {
    return this.safety.resetVersions(workspace.id);
  }

  @Get('blocked')
  async blocked(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('limit') limit?: string,
  ) {
    return this.safety.listBlocked(Number(limit) || 10, workspace.id);
  }

  /**
   * Dry-run endpoint for demos and tests: evaluates a hypothetical action
   * without writing anything or moving money.
   */
  @Post('evaluate')
  async evaluate(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Body()
    body: {
      type?: 'INVOICE' | 'PAYOUT_SINGLE' | 'PAYOUT_BATCH';
      payeeName?: string;
      payeePaypal?: string;
      amount?: string | number;
      currency?: string;
      purpose?: string;
      sourceText?: string;
      contact?: {
        payCount?: number;
        usualAmount?: string | number | null;
        paypalEmail?: string | null;
        name?: string;
      };
    },
  ) {
    const type = Object.values(ActionType).includes(body.type as ActionType)
      ? (body.type as ActionType)
      : ActionType.PAYOUT_SINGLE;
    return this.safety.evaluateCreation({
      workspaceId: workspace.id,
      type,
      payeeName: body.payeeName ?? 'Unknown',
      payeePaypal: body.payeePaypal ?? '',
      amount: body.amount ?? 0,
      currency: body.currency ?? 'USD',
      purpose: body.purpose ?? '',
      sourceText: body.sourceText ?? null,
      contact: body.contact
        ? {
            id: 'dry-run',
            name: body.contact.name ?? body.payeeName ?? 'Unknown',
            paypalEmail: body.contact.paypalEmail ?? null,
            payCount: body.contact.payCount ?? 0,
            usualAmount: body.contact.usualAmount ?? null,
            kind: 'SUPPLIER',
            currency: body.currency ?? 'USD',
          }
        : null,
    });
  }
}
