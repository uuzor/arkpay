import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionType, ContactKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { computeActionHash } from '../approvals/action-hash';
import { CurrentWorkspace } from '../auth/current-workspace.decorator';
import type { RequestSession } from '../auth/session.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ContactsService } from '../contacts/contacts.service';
import { parseSender } from '../contacts/sender';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
import { TelegramService } from './telegram.service';

interface DemoCardBody {
  emailId?: string;
  /** INVOICE (default) or PAYOUT_SINGLE. Batch payouts use team assembly. */
  type?: 'INVOICE' | 'PAYOUT_SINGLE';
  payeeName?: string;
  payeePaypal?: string;
  amount?: string | number;
  currency?: string;
  purpose?: string;
  confidence?: number;
  riskFlags?: string[];
  /** Simulate a prior successful payment so the card says "Known payee". */
  markPaid?: boolean;
}

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Phase-4 demo endpoint: create a PENDING_APPROVAL action in the caller's
 * workspace and send its Telegram card without waiting for the extraction
 * pipeline. Session-guarded like every other user route.
 */
@Controller('telegram')
@UseGuards(SessionAuthGuard)
export class TelegramDemoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
    private readonly safety: SafetyService,
  ) {}

  @Post('demo-card')
  async demoCard(
    @Body() body: DemoCardBody,
    @CurrentWorkspace() workspace: RequestSession['workspace'],
  ) {
    const linked = await this.prisma.telegramLink.findFirst({
      where: { workspaceId: workspace.id, telegramId: { not: null } },
    });
    if (!linked) {
      throw new BadRequestException(
        'no Telegram destination: link this workspace from the bot (/link <code>) first',
      );
    }
    // No emailId → NO source email. An earlier version attached the newest
    // inbox email as the "source", which quoted unrelated newsletters on the
    // card — a trust bug for a safety product. The card omits Source when null.
    const email = body.emailId
      ? await this.prisma.email.findFirst({
          where: { id: body.emailId, workspaceId: workspace.id },
        })
      : null;
    if (body.emailId && !email) {
      throw new BadRequestException(`email ${body.emailId} not found`);
    }

    const sender = email
      ? parseSender(email.from)
      : { name: 'Acme Studio', email: 'payments@acme.example' };
    const payeeName = (body.payeeName ?? sender.name).trim();
    const payeePaypal = (body.payeePaypal ?? sender.email).trim().toLowerCase();
    const amount = String(body.amount ?? '450.00').trim();
    const currency = (body.currency ?? 'USD').trim().toUpperCase();
    const purpose = (
      body.purpose ??
      email?.subject ??
      'Website redesign — October'
    ).trim();

    if (!payeeName || !payeePaypal) {
      throw new BadRequestException('payee name and PayPal email are required');
    }
    if (!AMOUNT_RE.test(amount)) {
      throw new BadRequestException(`invalid amount: ${amount}`);
    }
    if (!CURRENCY_RE.test(currency)) {
      throw new BadRequestException(`invalid currency: ${currency}`);
    }

    let contact = await this.contacts.findOrCreate(
      {
        name: payeeName,
        paypalEmail: payeePaypal,
        kind: ContactKind.CLIENT,
      },
      workspace.id,
    );
    if (body.markPaid) {
      contact = await this.contacts.recordPayment(
        contact.id,
        amount,
        currency,
        workspace.id,
      );
    }

    const ttlMinutes = Number(
      this.config.get<string>('APPROVAL_TTL_MINUTES') ?? 15,
    );
    const idempotencyKey = randomUUID();
    const actionHash = computeActionHash({
      payeeName,
      payeePaypal,
      amount,
      currency,
      purpose,
      idempotencyKey,
    });

    const type =
      body.type === 'PAYOUT_SINGLE' ? ActionType.PAYOUT_SINGLE : ActionType.INVOICE;
    if (body.type && body.type !== 'INVOICE' && body.type !== 'PAYOUT_SINGLE') {
      throw new BadRequestException(
        `invalid type: ${body.type} (want INVOICE or PAYOUT_SINGLE)`,
      );
    }

    const verdict = await this.safety.evaluateCreation({
      workspaceId: workspace.id,
      type,
      payeeName,
      payeePaypal,
      amount,
      currency,
      purpose,
      contact,
      sourceText: email?.body ?? body.purpose ?? null,
    });
    const action = await this.prisma.action.create({
      data: {
        workspaceId: workspace.id,
        type,
        status: 'PENDING_APPROVAL',
        emailId: email?.id,
        contactId: contact.id,
        payeeName,
        payeePaypal,
        amount,
        currency,
        purpose,
        extractedJson: { demo: true, source: 'phase4-demo' },
        riskFlags: verdict.flags,
        policyVersion: verdict.policyVersion,
        policyVerdict: verdict.verdict,
        safetySummary: verdict.summary,
        confidence:
          body.confidence === undefined ? 0.92 : Number(body.confidence),
        actionHash,
        idempotencyKey,
        expiresAt: new Date(
          Date.now() +
            (Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 15) *
              60_000,
        ),
      },
    });
    await this.safety.recordGate(action.id, verdict, 1, { via: 'demo-card' });
    const blocked = verdict.verdict === 'BLOCK';
    if (blocked) {
      await this.safety.block(action.id, verdict, 1, { via: 'demo-card' });
    }

    const messageId = blocked
      ? await this.telegram.sendBlockedNotice(action.id, verdict.reasons)
      : await this.telegram.sendDecisionCard(action.id);
    return {
      actionId: action.id,
      contactId: contact.id,
      messageId,
      knownPayee: contact.payCount > 0,
      payeeName,
      payeePaypal,
      amount,
      currency,
      purpose,
      blocked,
      verdict: verdict.verdict,
      riskFlags: verdict.flags,
    };
  }
}
