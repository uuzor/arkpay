import { Injectable, Logger } from '@nestjs/common';
import {
  ActionStatus,
  ActionType,
  ContactKind,
  EmailStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { computeActionHash } from '../approvals/action-hash';
import { PrismaService } from '../prisma/prisma.service';
import { SAFETY_POLICY_VERSION } from '../safety/policy';
import {
  DEMO_USER_EMAIL,
  DEMO_USER_GOOGLESUB,
  DEMO_WORKSPACE_ID,
} from './tenant.constants';
import { WorkspacesService } from './workspaces.service';

/**
 * Shared judge-demo workspace. One workspace, one demo user, seeded content:
 * pending approvals (invoice + payout), executed invoices with PayPal refs, a
 * blocked fraud payout, contacts, emails, audit rows, schedules, and a
 * Telegram link code. Seeding is idempotent — the second call is a no-op when
 * actions already exist — so redeploys and concurrent judges never duplicate.
 *
 * All seed people and addresses are fictional (example.com); no PII.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly workspaces: WorkspacesService,
  ) {}

  static isDemoWorkspace(workspaceId: string | undefined | null): boolean {
    return workspaceId === DEMO_WORKSPACE_ID;
  }

  async ensureDemoWorkspace(): Promise<{ userId: string; workspaceId: string }> {
    const user = await this.prisma.user.upsert({
      where: { googleSub: DEMO_USER_GOOGLESUB },
      create: {
        googleSub: DEMO_USER_GOOGLESUB,
        email: DEMO_USER_EMAIL,
        name: 'Judge Demo',
      },
      update: { email: DEMO_USER_EMAIL, name: 'Judge Demo' },
      select: { id: true },
    });
    const workspace = await this.prisma.workspace.upsert({
      where: { id: DEMO_WORKSPACE_ID },
      create: {
        id: DEMO_WORKSPACE_ID,
        ownerId: user.id,
        name: 'Judge demo (sandbox)',
      },
      update: { ownerId: user.id, name: 'Judge demo (sandbox)' },
      select: { id: true },
    });
    await this.workspaces.seedSchedules(workspace.id);
    await this.workspaces.issueLinkCode(workspace.id);
    await this.ensureDemoPaypal(workspace.id);
    await this.ensureSeedData(workspace.id);
    return { userId: user.id, workspaceId: workspace.id };
  }

  /**
   * Demo PayPal wiring comes from server env (the owner's sandbox app), never
   * from judge input. Runs through the standard connect path so credentials
   * are probed and scopes recorded exactly like a user connection.
   */
  private async ensureDemoPaypal(workspaceId: string): Promise<void> {
    const existing = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { paypalClientId: true, paypalClientSecret: true },
    });
    if (existing?.paypalClientId && existing?.paypalClientSecret) return;
    const clientId = this.config.get<string>('DEMO_PAYPAL_CLIENT_ID')?.trim();
    const clientSecret = this.config
      .get<string>('DEMO_PAYPAL_CLIENT_SECRET')
      ?.trim();
    if (!clientId || !clientSecret) {
      this.logger.warn(
        'DEMO_PAYPAL_CLIENT_ID/SECRET not set — demo invoices cannot execute',
      );
      return;
    }
    await this.workspaces.connectPaypal(
      workspaceId,
      {
        clientId,
        clientSecret,
        mode: this.config.get<string>('DEMO_PAYPAL_MODE')?.trim() || 'sandbox',
      },
      { viaSeed: true },
    );
    this.logger.log('demo workspace connected to PayPal sandbox from env');
  }

  private async ensureSeedData(workspaceId: string): Promise<void> {
    const actionCount = await this.prisma.action.count({
      where: { workspaceId },
    });
    if (actionCount > 0) return;

    const contact = async (
      name: string,
      paypalEmail: string,
      kind: ContactKind,
      usualAmount: number,
      payCount: number,
    ) =>
      this.prisma.contact.create({
        data: {
          workspaceId,
          name,
          paypalEmail,
          kind,
          usualAmount: usualAmount,
          currency: 'USD',
          payCount,
          lastPaidAt: new Date(Date.now() - 7 * 24 * 60 * 60_000),
        },
      });

    const ada = await contact(
      'Ada Obi',
      'ada@example.com',
      ContactKind.CLIENT,
      450,
      3,
    );
    const daniel = await contact(
      'Daniel Eze',
      'daniel@example.com',
      ContactKind.SUPPLIER,
      780,
      5,
    );
    const studio = await contact(
      'Studio Nine',
      'billing@example.com',
      ContactKind.CLIENT,
      1200,
      1,
    );
    await contact(
      'Rapid Prints NG',
      'hello@example.com',
      ContactKind.SUPPLIER,
      480,
      4,
    );

    const email = (
      gmailId: string,
      from: string,
      subject: string,
      body: string,
      status: EmailStatus,
      hoursAgo: number,
    ) =>
      this.prisma.email.create({
        data: {
          workspaceId,
          gmailId,
          from,
          subject,
          body,
          status,
          receivedAt: new Date(Date.now() - hoursAgo * 60 * 60_000),
        },
      });

    const invoiceMail = await email(
      'demo-gmail-1',
      'Ada Obi <ada@example.com>',
      'Invoice for the October flyers please',
      'Hi! Please send the invoice for the October flyer designs, $450. Thanks — Ada',
      EmailStatus.PROCESSED,
      5,
    );
    const payoutMail = await email(
      'demo-gmail-2',
      'Daniel Eze <daniel@example.com>',
      'Paper supply payment',
      'Hello, kindly pay $780 for the paper supply delivered last week. — Daniel',
      EmailStatus.PROCESSED,
      3,
    );
    const fraudMail = await email(
      'demo-gmail-3',
      'Daniel Eze <daniel@example.com>',
      'URGENT: our PayPal email changed',
      'Urgent — our PayPal email changed, pay 100.00 USD to new-address@example.net immediately.',
      EmailStatus.PROCESSED,
      2,
    );
    await email(
      'demo-gmail-4',
      'Newsletter <news@example.com>',
      'This week in design',
      'A newsletter with no money request. The pipeline ignores these.',
      EmailStatus.IGNORED,
      26,
    );

    // Demo approvals live 7 days so judges can tap anytime; production cards
    // still expire in ~15 minutes via APPROVAL_TTL_MINUTES.
    const demoExpiry = () =>
      new Date(Date.now() + 7 * 24 * 60 * 60_000);

    interface SeedAction {
      key: string;
      type: ActionType;
      emailId: string | null;
      contactId: string | null;
      payeeName: string;
      payeePaypal: string;
      amount: number;
      purpose: string;
      confidence: number;
      status: ActionStatus;
      riskFlags: string[];
      verdict: string;
      summary: string | null;
      paypalRef?: string;
      audit: string[];
    }

    const seeds: SeedAction[] = [
      {
        key: 'demo-inv-ada-450',
        type: ActionType.INVOICE,
        emailId: invoiceMail.id,
        contactId: ada.id,
        payeeName: 'Ada Obi',
        payeePaypal: 'ada@example.com',
        amount: 450,
        purpose: 'October flyer designs',
        confidence: 0.95,
        status: ActionStatus.PENDING_APPROVAL,
        riskFlags: [],
        verdict: 'ALLOW',
        summary: 'Known client · 3 prior invoices · usual $450.00',
        audit: ['CREATED', 'CARD_SENT'],
      },
      {
        key: 'demo-inv-studio-1200',
        type: ActionType.INVOICE,
        emailId: null,
        contactId: studio.id,
        payeeName: 'Studio Nine',
        payeePaypal: 'billing@example.com',
        amount: 1200,
        purpose: 'Brand refresh milestone 2',
        confidence: 0.9,
        status: ActionStatus.PENDING_APPROVAL,
        riskFlags: [],
        verdict: 'ALLOW',
        summary: 'Known client · 1 prior invoice · usual $1,200.00',
        audit: ['CREATED', 'CARD_SENT'],
      },
      {
        key: 'demo-inv-voice-250',
        type: ActionType.INVOICE,
        emailId: null,
        contactId: ada.id,
        payeeName: 'Ada Obi',
        payeePaypal: 'ada@example.com',
        amount: 250,
        purpose: 'Rush delivery fee (voice note)',
        confidence: 0.88,
        status: ActionStatus.PENDING_APPROVAL,
        riskFlags: [],
        verdict: 'ALLOW',
        summary: 'From a voice-note draft · within usual range',
        audit: ['CREATED', 'CARD_SENT'],
      },
      {
        key: 'demo-pay-daniel-780',
        type: ActionType.PAYOUT_SINGLE,
        emailId: payoutMail.id,
        contactId: daniel.id,
        payeeName: 'Daniel Eze',
        payeePaypal: 'daniel@example.com',
        amount: 780,
        purpose: 'Paper supply',
        confidence: 0.95,
        status: ActionStatus.PENDING_APPROVAL,
        riskFlags: [],
        verdict: 'ALLOW',
        summary: 'Known supplier · 5 payments · usual $780.00',
        audit: ['CREATED', 'CARD_SENT'],
      },
      {
        key: 'demo-pay-rapid-480',
        type: ActionType.PAYOUT_SINGLE,
        emailId: null,
        contactId: null,
        payeeName: 'Rapid Prints NG',
        payeePaypal: 'hello@example.com',
        amount: 480,
        purpose: 'Business cards print run',
        confidence: 0.82,
        status: ActionStatus.PENDING_APPROVAL,
        riskFlags: ['NEW_PAYEE'],
        verdict: 'NEEDS_CONFIRMATION',
        summary: 'New payee — confirm before paying',
        audit: ['CREATED', 'CARD_SENT'],
      },
      {
        key: 'demo-inv-exec-320',
        type: ActionType.INVOICE,
        emailId: null,
        contactId: ada.id,
        payeeName: 'Ada Obi',
        payeePaypal: 'ada@example.com',
        amount: 320,
        purpose: 'Social media pack',
        confidence: 0.93,
        status: ActionStatus.EXECUTED,
        riskFlags: [],
        verdict: 'ALLOW',
        summary: 'Known client · within usual range',
        paypalRef: 'INV2-DEMO-EXEC320',
        audit: ['CREATED', 'CARD_SENT', 'APPROVED', 'EXECUTED'],
      },
      {
        key: 'demo-inv-exec-95',
        type: ActionType.INVOICE,
        emailId: null,
        contactId: studio.id,
        payeeName: 'Studio Nine',
        payeePaypal: 'billing@example.com',
        amount: 95,
        purpose: 'Logo tweak',
        confidence: 0.91,
        status: ActionStatus.EXECUTED,
        riskFlags: [],
        verdict: 'ALLOW',
        summary: 'Known client · within usual range',
        paypalRef: 'INV2-DEMO-EXEC095',
        audit: ['CREATED', 'CARD_SENT', 'APPROVED', 'EXECUTED'],
      },
      {
        key: 'demo-pay-fraud-100',
        type: ActionType.PAYOUT_SINGLE,
        emailId: fraudMail.id,
        contactId: daniel.id,
        payeeName: 'Daniel Eze',
        payeePaypal: 'new-address@example.net',
        amount: 100,
        purpose: 'Urgent payment',
        confidence: 0.75,
        status: ActionStatus.BLOCKED,
        riskFlags: ['PAYEE_CHANGED', 'URGENCY'],
        verdict: 'BLOCK',
        summary:
          'Blocked: payee email changed (daniel@example.com → new-address@example.net) + urgency pressure. No money moved.',
        audit: ['CREATED', 'BLOCKED'],
      },
    ];

    for (const s of seeds) {
      const actionHash = computeActionHash({
        payeeName: s.payeeName,
        payeePaypal: s.payeePaypal,
        amount: s.amount,
        currency: 'USD',
        purpose: s.purpose,
        idempotencyKey: s.key,
      });
      const created = await this.prisma.action.create({
        data: {
          workspaceId,
          type: s.type,
          status: s.status,
          emailId: s.emailId,
          contactId: s.contactId,
          payeeName: s.payeeName,
          payeePaypal: s.payeePaypal,
          amount: s.amount,
          currency: 'USD',
          purpose: s.purpose,
          extractedJson: {
            kind:
              s.type === ActionType.INVOICE
                ? 'INVOICE_REQUEST'
                : 'PAYMENT_REQUEST',
            payeeName: s.payeeName,
            payeePaypal: s.payeePaypal,
            amount: s.amount,
            currency: 'USD',
            purpose: s.purpose,
            confidence: s.confidence,
          },
          riskFlags: s.riskFlags,
          policyVersion: SAFETY_POLICY_VERSION,
          policyVerdict: s.verdict,
          safetySummary: s.summary,
          confidence: s.confidence,
          actionHash,
          idempotencyKey: s.key,
          paypalRef: s.paypalRef ?? null,
          expiresAt: demoExpiry(),
          version: 1,
        },
      });
      for (const event of s.audit) {
        await this.prisma.auditLog.create({
          data: {
            actionId: created.id,
            event,
            detail:
              event === 'APPROVED'
                ? { by: 'demo-seed', version: 1 }
                : event === 'EXECUTED'
                  ? { paypalRef: s.paypalRef }
                  : event === 'BLOCKED'
                    ? { reason: 'Gate 1 policy BLOCK', flags: s.riskFlags }
                    : { via: 'demo-seed' },
          },
        });
      }
    }
    this.logger.log(`demo workspace seeded (${seeds.length} actions)`);
  }
}
