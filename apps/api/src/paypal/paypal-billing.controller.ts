import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  assessDispute,
  assessSubscription,
  humanDisputeReason,
  summarizePortfolio,
} from './billing-analysis';
import { PaypalDisputesService } from './paypal-disputes.service';
import { PaypalSubscriptionsService } from './paypal-subscriptions.service';

/**
 * Subscription + dispute reads for the dashboard. Live PayPal data (these
 * objects live at PayPal; ArkPay rows only exist once an action is drafted),
 * merged with the code-side assessment the agent uses.
 */
@Controller('billing')
@UseGuards(SessionAuthGuard)
export class PaypalBillingController {
  constructor(
    private readonly subscriptions: PaypalSubscriptionsService,
    private readonly disputes: PaypalDisputesService,
  ) {}

  @Get('subscriptions')
  async listSubscriptions(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('status') status?: string,
  ) {
    const statuses = status
      ? status.split(',').map((s) => s.trim().toUpperCase())
      : undefined;
    const allowed = new Set([
      'APPROVAL_PENDING',
      'APPROVED',
      'ACTIVE',
      'SUSPENDED',
      'CANCELLED',
      'EXPIRED',
    ]);
    if (statuses?.some((s) => !allowed.has(s))) {
      throw new BadRequestException(
        `invalid status: ${status} (want ${[...allowed].join(', ')})`,
      );
    }
    const rows = await this.subscriptions.listSubscriptions(workspace.id, {
      ...(statuses ? { statuses: statuses as never[] } : {}),
      pageSize: 50,
    });
    return { rows, report: summarizePortfolio(rows) };
  }

  @Get('subscriptions/:id')
  async subscriptionDetail(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    const sub = await this.subscriptions.getSubscription(id, workspace.id);
    let transactions: unknown = [];
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 90 * 86_400_000);
      transactions = await this.subscriptions.listTransactions(
        id,
        workspace.id,
        start.toISOString(),
        end.toISOString(),
      );
    } catch {
      transactions = 'unavailable';
    }
    return { ...sub, raw: undefined, assessment: assessSubscription(sub), transactions };
  }

  @Get('disputes')
  async listDisputes(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('state') state?: string,
  ) {
    const states = state
      ? state.split(',').map((s) => s.trim().toUpperCase())
      : undefined;
    const rows = await this.disputes.listDisputes(workspace.id, {
      ...(states ? { state: states as never[] } : {}),
      pageSize: 50,
    });
    return {
      rows: rows.map((d) => ({
        ...d,
        reasonText: humanDisputeReason(d.reason),
      })),
    };
  }

  @Get('disputes/:id')
  async disputeDetail(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    const dispute = await this.disputes.getDispute(id, workspace.id);
    return {
      ...dispute,
      raw: undefined,
      reasonText: humanDisputeReason(dispute.reason),
      assessment: assessDispute(dispute),
    };
  }
}
