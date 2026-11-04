import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ContactKind } from '@prisma/client';
import {
  CurrentUser,
  CurrentWorkspace,
} from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { DraftService } from './drafts.service';

interface CreateDraftBody {
  payeeName?: string;
  payeeEmail?: string;
  amount?: string | number;
  currency?: string;
  purpose?: string;
  /** SUPPLIER default; STAFF for one-off team payments. */
  contactKind?: string;
  /** Client key for idempotent creates (dashboard double-submit). */
  idempotencyKey?: string;
}

/**
 * Dashboard creation surface: invoices and single payouts without going
 * through the agent chat. Lands on the same DraftService the agent tools
 * use — Gate 1, audit, and card dispatch cannot drift between surfaces.
 * Lives in TelegramModule (like the agent chat and payroll controllers)
 * because only that module wires the drafts service without cycling.
 */
@Controller()
@UseGuards(SessionAuthGuard)
export class CreationController {
  constructor(private readonly drafts: DraftService) {}

  @Post('invoices')
  async createInvoice(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @CurrentUser() user: RequestSession['user'],
    @Body() body: CreateDraftBody,
  ) {
    const payload = body ?? {};
    const result = await this.drafts.createInvoice(
      {
        payeeName: payload.payeeName,
        payeeEmail: payload.payeeEmail,
        amount: payload.amount,
        currency: payload.currency,
        purpose: payload.purpose,
        idempotencyKey: payload.idempotencyKey,
      },
      {
        workspaceId: workspace.id,
        via: 'dashboard',
        by: user.id,
      },
    );
    return { ...result, actionUrl: `/approvals/${result.actionId}` };
  }

  @Post('payouts')
  async createPayout(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @CurrentUser() user: RequestSession['user'],
    @Body() body: CreateDraftBody,
  ) {
    const kind =
      body?.contactKind === 'STAFF' ? ContactKind.STAFF : ContactKind.SUPPLIER;
    const result = await this.drafts.createPayout(
      { ...(body ?? {}), contactKind: kind },
      { workspaceId: workspace.id, via: 'dashboard', by: user.id },
    );
    return { ...result, actionUrl: `/approvals/${result.actionId}` };
  }
}
