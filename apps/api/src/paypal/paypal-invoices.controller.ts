import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ActionStatus, ActionType, Prisma } from '@prisma/client';
import type { Response } from 'express';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AuditService } from '../audit/audit.service';
import { csvDocument } from '../common/csv';
import { PrismaService } from '../prisma/prisma.service';
import { PaypalInvoicesService } from './paypal-invoices.service';

/**
 * Invoice ledger for the dashboard Invoices tab. ArkPay's action rows are the
 * source of truth; the detail route merges the live PayPal status when the
 * invoice was sent, plus reminder and webhook history from the audit trail.
 */
@Controller('invoices')
@UseGuards(SessionAuthGuard)
export class PaypalInvoicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: PaypalInvoicesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (
      status &&
      !Object.values(ActionStatus).includes(status as ActionStatus)
    ) {
      throw new BadRequestException(
        `invalid status: ${status} (want ${Object.values(ActionStatus).join(', ')})`,
      );
    }
    const take = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 100);
    const where: Prisma.ActionWhereInput = {
      workspaceId: workspace.id,
      type: ActionType.INVOICE,
      ...(status ? { status: status as ActionStatus } : {}),
    };
    const rows = await this.prisma.action.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        status: true,
        payeeName: true,
        payeePaypal: true,
        amount: true,
        currency: true,
        purpose: true,
        dueDate: true,
        paypalRef: true,
        riskFlags: true,
        policyVerdict: true,
        expiresAt: true,
        createdAt: true,
        email: { select: { from: true, subject: true } },
        contact: { select: { name: true } },
      },
    });
    const page = rows.slice(0, take);
    return {
      rows: page,
      nextCursor: rows.length > take ? page[page.length - 1].id : null,
      totalCount: await this.prisma.action.count({ where }),
    };
  }

  /**
   * CSV export of invoices for the dashboard Export button. Same tenant
   * scoping and status filter as the list; capped at 2000 newest rows.
   * Declared before `:id` so `export` matches here.
   */
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Query('status') status: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (
      status &&
      !Object.values(ActionStatus).includes(status as ActionStatus)
    ) {
      throw new BadRequestException(
        `invalid status: ${status} (want ${Object.values(ActionStatus).join(', ')})`,
      );
    }
    const rows = await this.prisma.action.findMany({
      where: {
        workspaceId: workspace.id,
        type: ActionType.INVOICE,
        ...(status ? { status: status as ActionStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 2000,
      select: {
        id: true,
        createdAt: true,
        status: true,
        payeeName: true,
        payeePaypal: true,
        amount: true,
        currency: true,
        purpose: true,
        dueDate: true,
        paypalRef: true,
        policyVerdict: true,
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="arkpay-invoices-${day}.csv"`,
    );
    return csvDocument(
      [
        'id',
        'created_at',
        'status',
        'payee_name',
        'payee_paypal',
        'amount',
        'currency',
        'purpose',
        'due_date',
        'paypal_ref',
        'policy_verdict',
      ],
      rows.map((r) => [
        r.id,
        r.createdAt,
        r.status,
        r.payeeName,
        r.payeePaypal,
        String(r.amount),
        r.currency,
        r.purpose,
        r.dueDate,
        r.paypalRef,
        r.policyVerdict,
      ]),
    );
  }

  @Get(':id')
  async detail(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    const action = await this.prisma.action.findFirst({
      where: { id, type: ActionType.INVOICE, workspaceId: workspace.id },
      include: {
        email: { select: { from: true, subject: true } },
        contact: { select: { id: true, name: true } },
      },
    });
    if (!action) throw new NotFoundException(`invoice action ${id} not found`);
    const paypal = action.paypalRef
      ? await this.invoices
          .getInvoice(action.paypalRef, workspace.id)
          .then((invoice) => ({
            available: true as const,
            id: invoice.id,
            status: invoice.status,
          }))
          .catch((e: unknown) => ({
            available: false as const,
            reason: e instanceof Error ? e.message : String(e),
          }))
      : { available: false as const, reason: 'not sent to PayPal yet' };
    const [reminders, webhookEvents] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { actionId: id, event: 'REMINDER_SENT' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.findMany({
        where: { actionId: id, event: { startsWith: 'WEBHOOK_' } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return { action, paypal, reminders, webhookEvents };
  }

  /**
   * Send one PayPal payment reminder now (dashboard chase list). Refuses
   * unsent invoices and already-paid ones — the live PayPal status decides,
   * never the dashboard. Audited as REMINDER_SENT like scheduler runs.
   */
  @Post(':id/remind')
  async remindNow(
    @CurrentWorkspace() workspace: RequestSession['workspace'],
    @Param('id') id: string,
  ) {
    const action = await this.prisma.action.findFirst({
      where: { id, type: ActionType.INVOICE, workspaceId: workspace.id },
    });
    if (!action) throw new NotFoundException(`invoice action ${id} not found`);
    if (!action.paypalRef) {
      throw new BadRequestException('invoice has not been sent yet');
    }
    const invoice = await this.invoices.getInvoice(
      action.paypalRef,
      workspace.id,
    );
    if (invoice.status.toUpperCase() === 'PAID') {
      return { ok: true, alreadyPaid: true, paypalRef: action.paypalRef };
    }
    await this.invoices.remindInvoice(
      action.paypalRef,
      workspace.id,
      'Friendly reminder from ArkPay — please let us know if you need the invoice resent.',
    );
    await this.audit.log(action.id, 'REMINDER_SENT', {
      via: 'dashboard',
      paypalRef: action.paypalRef,
    });
    return { ok: true, paypalRef: action.paypalRef };
  }
}
