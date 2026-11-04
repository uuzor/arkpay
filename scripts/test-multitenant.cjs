#!/usr/bin/env node
/**
 * Phase 10c+10d gate: multi-tenant execution.
 * - per-workspace Gmail sync (live historySync on the staged owner mailbox,
 *   bogus-token rejection for an unknown workspace, poller iteration shape)
 * - PayPal credential resolution (stored owner creds consulted; unconnected
 *   workspaces fail closed with no shared app)
 * - Telegram card routing (fake transport captures the destination chat;
 *   no message leaves the box; unlinked workspaces get nothing)
 * - webhook tenant pre-attribution from the unverified resource
 * - scheduler fairness: due schedules in two workspaces both run on one tick
 *
 * Boots an application context (no HTTP, no poller launch, no Telegram
 * launch). Precondition: owner credentials staged
 * (owner:connect-gmail, owner:connect-paypal).
 *
 * Run: pnpm --filter @arkpay/api test:multitenant
 */
const assert = require('node:assert/strict');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/app.module');
const { PrismaService } = require('../apps/api/dist/prisma/prisma.service');
const {
  GmailIngestService,
} = require('../apps/api/dist/ingest/gmail-ingest.service');
const {
  GmailPollerService,
} = require('../apps/api/dist/ingest/gmail-poller.service');
const {
  PaypalAuthService,
} = require('../apps/api/dist/paypal/paypal-auth.service');
const {
  PaypalWebhooksService,
} = require('../apps/api/dist/paypal/webhooks/webhooks.service');
const {
  TelegramService,
} = require('../apps/api/dist/telegram/telegram.service');
const { AuditService } = require('../apps/api/dist/audit/audit.service');
const {
  SchedulerService,
} = require('../apps/api/dist/scheduler/scheduler.service');
const {
  OWNER_WORKSPACE_ID,
} = require('../apps/api/dist/auth/tenant.constants');

const stamp = Date.now().toString(36);
const WS_A = `mt-a-${stamp}`;
const WS_B = `mt-b-${stamp}`;
const WS_C = `mt-c-${stamp}`;
const CHAT_A = `chat-A-${stamp}`;
const CHAT_B = `chat-B-${stamp}`;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const prisma = app.get(PrismaService);
  const ingest = app.get(GmailIngestService);
  const poller = app.get(GmailPollerService);
  const paypalAuth = app.get(PaypalAuthService);
  const webhooks = app.get(PaypalWebhooksService);
  const scheduler = app.get(SchedulerService);

  const created = { workspaces: [], schedules: [] };
  const trackWs = (id) => created.workspaces.push(id);
  try {
    // --- precondition: owner staged ---
    const owner = await prisma.workspace.findUnique({
      where: { id: OWNER_WORKSPACE_ID },
    });
    assert.ok(
      owner?.gmailRefreshToken && owner?.gmailAddress,
      'owner gmail not staged — run owner:connect-gmail first',
    );
    assert.ok(
      owner?.paypalClientId && owner?.paypalClientSecret,
      'owner paypal not staged — run owner:connect-paypal first',
    );
    console.log('[PASS] owner credentials staged');

    // --- 1. per-workspace Gmail sync (live) ---
    const sync = await ingest.syncOnce({
      workspaceId: OWNER_WORKSPACE_ID,
      refreshToken: owner.gmailRefreshToken,
      gmailAddress: owner.gmailAddress,
    });
    assert.equal(sync.mailbox, owner.gmailAddress);
    assert.ok(sync.inserted >= 0);
    console.log(
      `[PASS] owner mailbox sync via stored creds (${sync.mode}, ${sync.inserted} new)`,
    );
    await assert.rejects(
      () =>
        ingest.syncOnce({
          workspaceId: `mt-bogus-${stamp}`,
          refreshToken: 'bogus-refresh-token',
        }),
      /Gmail OAuth refresh failed/,
    );
    console.log('[PASS] bogus workspace refresh token rejected by Google');

    // --- 2. poller iterates stored connections (offline shape) ---
    const calls = [];
    const origSync = ingest.syncOnce.bind(ingest);
    ingest.syncOnce = async (conn) => {
      calls.push(conn ?? null);
      return {
        mode: 'history',
        mailbox: conn?.gmailAddress ?? 'env',
        fetched: 0,
        inserted: 0,
        checkpoint: 'x',
      };
    };
    try {
      await poller.syncAllMailboxes();
    } finally {
      ingest.syncOnce = origSync;
    }
    assert.ok(calls.length >= 1, 'poller syncs stored connections');
    assert.ok(
      calls.every((c) => c && c.workspaceId && c.refreshToken),
      'every poll carries a stored connection (no env mailbox)',
    );
    const ownerCall = calls.find((c) => c?.workspaceId === OWNER_WORKSPACE_ID);
    assert.ok(ownerCall, 'poller did not sync the staged owner mailbox');
    assert.equal(ownerCall.refreshToken, owner.gmailRefreshToken);
    assert.equal(ownerCall.gmailAddress, owner.gmailAddress);
    console.log('[PASS] poller syncs each stored connection (no env mailbox)');

    // --- 3. PayPal credential resolution (live) ---
    paypalAuth.cached.clear();
    const ctx = await paypalAuth.context(OWNER_WORKSPACE_ID);
    assert.ok(ctx.token.length > 20);
    assert.ok(ctx.baseUrl.includes('sandbox.paypal.com'));
    console.log('[PASS] owner PayPal context resolves a live token');
    // Negative: bogus stored creds must fail — proves the row is consulted.
    paypalAuth.cached.clear();
    await prisma.workspace.update({
      where: { id: OWNER_WORKSPACE_ID },
      data: { paypalClientId: 'bogus', paypalClientSecret: 'bogus' },
    });
    try {
      await assert.rejects(() => paypalAuth.context(OWNER_WORKSPACE_ID));
    } finally {
      await prisma.workspace.update({
        where: { id: OWNER_WORKSPACE_ID },
        data: {
          paypalClientId: owner.paypalClientId,
          paypalClientSecret: owner.paypalClientSecret,
        },
      });
      paypalAuth.cached.clear();
    }
    console.log('[PASS] stored PayPal row is consulted (bogus fails)');
    await assert.rejects(
      () => paypalAuth.context(`mt-unknown-${stamp}`),
      /not connected/,
      'unconnected workspace fails closed',
    );
    console.log('[PASS] unconnected workspace fails closed (no shared app)');

    // --- 4. Telegram routing (fake transport) ---
    await prisma.workspace.createMany({
      data: [
        { id: WS_A, name: 'mt-a' },
        { id: WS_B, name: 'mt-b' },
        { id: WS_C, name: 'mt-c' },
      ],
    });
    [WS_A, WS_B, WS_C].forEach(trackWs);
    await prisma.telegramLink.createMany({
      data: [
        {
          workspaceId: WS_A,
          linkCode: `mt-link-${stamp}-a`,
          telegramId: CHAT_A,
          linkedAt: new Date(),
        },
        {
          workspaceId: WS_B,
          linkCode: `mt-link-${stamp}-b`,
          telegramId: CHAT_B,
          linkedAt: new Date(),
        },
      ],
    });
    const captured = [];
    let messageId = 0;
    const fakeBot = {
      telegram: {
        sendMessage: async (chatId, text) => {
          captured.push({ kind: 'message', chatId: String(chatId), text });
          messageId += 1;
          return { message_id: messageId };
        },
        sendDocument: async (chatId) => {
          captured.push({ kind: 'document', chatId: String(chatId) });
          messageId += 1;
          return { message_id: messageId };
        },
      },
    };
    const telegram = new TelegramService(
      fakeBot,
      prisma,
      new AuditService(prisma),
    );
    const lastChat = () => captured[captured.length - 1].chatId;

    await telegram.sendMessage('hello-a', WS_A);
    assert.equal(lastChat(), CHAT_A);
    await telegram.sendMessage('hello-b', WS_B);
    assert.equal(lastChat(), CHAT_B);
    const beforeSkip = captured.length;
    await telegram.sendMessage('hello-unlinked', WS_C);
    await telegram.sendMessage('hello-legacy');
    assert.equal(
      captured.length,
      beforeSkip,
      'unlinked workspaces get nothing (fail-closed)',
    );
    console.log('[PASS] sendMessage routes by link, skips unlinked');

    const emailB = await prisma.email.create({
      data: {
        workspaceId: WS_B,
        gmailId: `mt-gmail-${stamp}`,
        from: 'billing@example.com',
        subject: 'Invoice please',
        body: 'Please send the invoice for October hosting, $450.',
        status: 'NEW',
        receivedAt: new Date(),
      },
    });
    const contactB = await prisma.contact.create({
      data: {
        workspaceId: WS_B,
        name: `MT Contact ${stamp}`,
        paypalEmail: `mt-contact-${stamp}@example.com`,
        kind: 'CLIENT',
        currency: 'USD',
      },
    });
    const actionB = await prisma.action.create({
      data: {
        workspaceId: WS_B,
        type: 'INVOICE',
        emailId: emailB.id,
        contactId: contactB.id,
        payeeName: `MT Payee ${stamp}`,
        payeePaypal: `mt-payee-${stamp}@example.com`,
        amount: '450.00',
        currency: 'USD',
        purpose: `mt-card-${stamp}`,
        actionHash: `mt-hash-${stamp}`,
        idempotencyKey: `mt-key-${stamp}`,
        extractedJson: {},
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    await telegram.sendDecisionCard(actionB.id);
    assert.equal(lastChat(), CHAT_B);
    const cardAudit = await prisma.auditLog.findFirst({
      where: { actionId: actionB.id, event: 'CARD_SENT' },
    });
    assert.equal(cardAudit?.detail?.chatId, CHAT_B);
    console.log('[PASS] decision card routes to the action workspace link');

    await telegram.sendActionMessage(actionB.id, 'receipt');
    assert.equal(lastChat(), CHAT_B);
    console.log('[PASS] action receipt routes to the action workspace link');

    const batchId = `mt-batch-${stamp}`;
    const contactA = await prisma.contact.create({
      data: {
        workspaceId: WS_A,
        name: `MT Contact A ${stamp}`,
        paypalEmail: `mt-contact-a-${stamp}@example.com`,
        kind: 'SUPPLIER',
        currency: 'USD',
      },
    });
    for (const tag of ['m1', 'm2']) {
      await prisma.action.create({
        data: {
          workspaceId: WS_A,
          type: 'PAYOUT_BATCH',
          contactId: contactA.id,
          batchId,
          payeeName: `MT Member ${stamp} ${tag}`,
          payeePaypal: `mt-${tag}-${stamp}@example.com`,
          amount: '10.00',
          currency: 'USD',
          purpose: `mt-batch-${stamp}`,
          actionHash: `mt-bhash-${stamp}-${tag}`,
          idempotencyKey: `mt-bkey-${stamp}-${tag}`,
          extractedJson: {},
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
    }
    await telegram.sendBatchCard(batchId);
    assert.equal(lastChat(), CHAT_A);
    await telegram.sendBatchMessage(batchId, 'batch receipt');
    assert.equal(lastChat(), CHAT_A);
    await telegram.sendDocument(Buffer.from('x'), 'mt.txt', 'cap', WS_A);
    assert.equal(lastChat(), CHAT_A);
    assert.equal(captured[captured.length - 1].kind, 'document');
    console.log('[PASS] batch card, batch receipt, document route by workspace');

    // --- 5. webhook pre-attribution (offline) ---
    const paypalRef = `INV2-MT-${stamp.toUpperCase()}`;
    const batchRef = `BATCH-MT-${stamp.toUpperCase()}`;
    const attrAction = await prisma.action.create({
      data: {
        workspaceId: WS_B,
        type: 'INVOICE',
        payeeName: `MT Attr ${stamp}`,
        payeePaypal: `mt-attr-${stamp}@example.com`,
        amount: '5.00',
        currency: 'USD',
        purpose: `mt-attr-${stamp}`,
        actionHash: `mt-ahash-${stamp}`,
        idempotencyKey: `mt-akey-${stamp}`,
        extractedJson: {},
        paypalRef,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    const attrAction2 = await prisma.action.create({
      data: {
        workspaceId: WS_B,
        type: 'PAYOUT_SINGLE',
        payeeName: `MT Attr2 ${stamp}`,
        payeePaypal: `mt-attr2-${stamp}@example.com`,
        amount: '5.00',
        currency: 'USD',
        purpose: `mt-attr2-${stamp}`,
        actionHash: `mt-ahash2-${stamp}`,
        idempotencyKey: `mt-akey2-${stamp}`,
        extractedJson: {},
        paypalRef: batchRef,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    assert.equal(
      await webhooks.preAttributeTenant('INVOICING.INVOICE.PAID', {
        invoice: { id: paypalRef },
      }),
      WS_B,
    );
    assert.equal(
      await webhooks.preAttributeTenant('PAYMENT.PAYOUTSBATCH.SUCCESS', {
        batch_header: { payout_batch_id: batchRef },
      }),
      WS_B,
    );
    assert.equal(
      await webhooks.preAttributeTenant('INVOICING.INVOICE.PAID', {
        invoice: { id: 'INV2-UNKNOWN' },
      }),
      null,
    );
    console.log('[PASS] webhook pre-attribution resolves the executing tenant');

    // --- 6. scheduler fairness across tenants ---
    const mkNoop = (workspaceId, tag) =>
      scheduler.create(
        {
          title: `MT noop ${stamp} ${tag}`,
          detail: 'multitenant fairness probe',
          kind: 'NOOP',
          trigger: 'INTERVAL',
          intervalMinutes: 1440,
          payload: {},
          misfireGraceMinutes: 60,
        },
        workspaceId,
      );
    const schedA = await mkNoop(WS_A, 'a');
    const schedB = await mkNoop(WS_B, 'b');
    created.schedules.push(schedA.id, schedB.id);
    await prisma.schedule.updateMany({
      where: { id: { in: [schedA.id, schedB.id] } },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });
    await scheduler.tick();
    for (const id of [schedA.id, schedB.id]) {
      const runs = await prisma.scheduleRun.count({
        where: { scheduleId: id },
      });
      assert.equal(runs, 1, `schedule ${id} should have exactly one run`);
    }
    console.log('[PASS] one tick runs due schedules in both workspaces');

    console.log('\nAll 10c multitenant checks passed');
  } finally {
    for (const ws of created.workspaces) {
      await prisma.auditLog.deleteMany({
        where: { action: { workspaceId: ws } },
      });
      await prisma.action.deleteMany({ where: { workspaceId: ws } });
      await prisma.scheduleRun.deleteMany({
        where: { schedule: { workspaceId: ws } },
      });
      await prisma.schedule.deleteMany({ where: { workspaceId: ws } });
      await prisma.telegramLink.deleteMany({ where: { workspaceId: ws } });
      await prisma.contact.deleteMany({ where: { workspaceId: ws } });
      await prisma.email.deleteMany({ where: { workspaceId: ws } });
      await prisma.workspace.deleteMany({ where: { id: ws } });
    }
    // Telegraf was never launched in this context; its shutdown hook
    // complains — same swallow as test-tenancy.cjs.
    await app.close().catch((e) => {
      if (!String(e?.message ?? e).includes('Bot is not running')) throw e;
    });
  }
}

main().catch((e) => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
