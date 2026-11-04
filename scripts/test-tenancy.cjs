#!/usr/bin/env node
/**
 * Phase 10a+10b+10d gate: tenancy — sessions/guard, owner adoption, contacts
 * isolation, per-workspace uniques, Telegram pairing, connect flows, plus
 * 10b action/schedule/payroll/audit isolation, execution tenant checks,
 * per-tenant safety history, and 10d guard-all, link-based Telegram auth,
 * fail-closed unlinked workspaces, and NOT NULL tenants.
 *
 * Boots the real HTTP app on an ephemeral port (no poller/scheduler/Telegram
 * launch). The live Google round-trips (login callback, Gmail code exchange,
 * valid PayPal probe) and webhook attribution stay manual — this script
 * proves everything around them.
 *
 * Run: pnpm --filter @arkpay/api test:tenancy
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/app.module');
const { PrismaService } = require('../apps/api/dist/prisma/prisma.service');
const {
  SessionService,
} = require('../apps/api/dist/auth/session.service');
const {
  WorkspacesService,
} = require('../apps/api/dist/auth/workspaces.service');
const {
  ContactsService,
} = require('../apps/api/dist/contacts/contacts.service');
const {
  DecisionService,
} = require('../apps/api/dist/approvals/decision.service');
const {
  SafetyService,
} = require('../apps/api/dist/safety/safety.service');
const {
  TelegramService,
} = require('../apps/api/dist/telegram/telegram.service');
const {
  PaypalAuthService,
} = require('../apps/api/dist/paypal/paypal-auth.service');

const stamp = Date.now().toString(36);
const SUB_A = `tenancy-a-${stamp}`;
const SUB_B = `tenancy-b-${stamp}`;
const CONTACT_NAME = `Tenancy Probe ${stamp}`;

function request(port, method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => {
      req.destroy(new Error(`timeout ${method} ${path}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

const get = (port, path, cookie) =>
  request(
    port,
    'GET',
    path,
    cookie ? { headers: { Cookie: cookie } } : {},
  );

async function cleanup(prisma) {
  const users = await prisma.user.findMany({
    where: { googleSub: { startsWith: 'tenancy-' } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const workspaces = await prisma.workspace.findMany({
    where: {
      OR: [{ ownerId: { in: userIds } }, { id: 'owner' }],
    },
    select: { id: true },
  });
  const testWs = workspaces.map((w) => w.id).filter((id) => id !== 'owner');
  for (const id of testWs) {
    await prisma.telegramLink.deleteMany({ where: { workspaceId: id } });
    await prisma.scheduleRun.deleteMany({
      where: { schedule: { workspaceId: id } },
    });
    await prisma.schedule.deleteMany({ where: { workspaceId: id } });
    await prisma.auditLog.deleteMany({
      where: { action: { workspaceId: id } },
    });
    await prisma.action.deleteMany({ where: { workspaceId: id } });
    await prisma.contact.deleteMany({ where: { workspaceId: id } });
    await prisma.agentMessage.deleteMany({ where: { workspaceId: id } });
    await prisma.payrollRun.deleteMany({ where: { workspaceId: id } });
    await prisma.workspace.delete({ where: { id } });
  }
  // Owner workspace: only ever reset the adoption + test rows.
  await prisma.telegramLink.deleteMany({ where: { workspaceId: 'owner' } });
  await prisma.contact.deleteMany({
    where: { workspaceId: 'owner', name: { startsWith: 'Tenancy Probe' } },
  });
  const probeActions = await prisma.action.findMany({
    where: { purpose: { contains: 'tenancy-probe-' } },
    select: { id: true },
  });
  const probeIds = probeActions.map((a) => a.id);
  if (probeIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actionId: { in: probeIds } } });
    await prisma.action.deleteMany({ where: { id: { in: probeIds } } });
  }
  await prisma.payrollRun.deleteMany({ where: { period: '2099-01' } });
  await prisma.schedule.deleteMany({
    where: { title: { startsWith: 'Tenancy Probe' } },
  });
  await prisma.workspace.update({
    where: { id: 'owner' },
    data: { ownerId: null },
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const prisma = app.get(PrismaService);
  const sessions = app.get(SessionService);
  const workspaces = app.get(WorkspacesService);
  const contacts = app.get(ContactsService);
  const decision = app.get(DecisionService);
  const safety = app.get(SafetyService);
  const telegram = app.get(TelegramService);
  const paypalAuth = app.get(PaypalAuthService);

  try {
    // Self-healing preamble: a crashed run must not poison adoption.
    await cleanup(prisma);

    // 1. Guard-all: every user route 401s without a session.
    const unauth = [
      ['GET', '/auth/me'],
      ['GET', '/workspaces/me'],
      ['POST', '/telegram/link-code'],
      ['POST', '/telegram/team-payout'],
      ['POST', '/telegram/demo-card'],
      ['GET', '/contacts'],
      ['GET', '/approvals'],
      ['GET', '/schedules'],
      ['GET', '/payroll'],
      ['GET', '/payroll/2099-01'],
      ['GET', '/ingest/emails'],
      ['GET', '/ingest/status'],
      ['POST', '/ingest/run'],
      ['GET', '/invoices'],
      ['GET', '/payouts'],
      ['GET', '/payouts/batches'],
      ['GET', '/audit/recent'],
      ['GET', '/safety/blocked'],
      ['GET', '/agent/messages'],
      ['POST', '/agent/chat'],
      ['POST', '/pipeline/run'],
      ['GET', '/pipeline/status'],
      ['GET', '/paypal/webhooks'],
      ['POST', '/paypal/webhooks'],
    ];
    for (const [method, path] of unauth) {
      assert.equal(
        (await request(port, method, path)).status,
        401,
        `${method} ${path} 401s`,
      );
    }
    console.log('[PASS] guard-all: 24 user routes 401 without a session');

    // 2. First user adopts the owner workspace; session lifecycle works.
    const userA = await prisma.user.create({
      data: { googleSub: SUB_A, email: `a-${stamp}@example.com` },
    });
    const wsA = await workspaces.provisionForUser(userA.id, userA.email);
    assert.equal(wsA, 'owner', 'first signup adopts the owner workspace');
    const owner = await prisma.workspace.findUnique({ where: { id: 'owner' } });
    assert.equal(owner.ownerId, userA.id, 'adoption stamps ownerId');
    // Second provision call is idempotent.
    assert.equal(
      await workspaces.provisionForUser(userA.id, userA.email),
      'owner',
    );
    const { token } = await sessions.create(userA.id);
    const cookie = `arkpay_session=${token}`;
    const me = await get(port, '/auth/me', cookie);
    assert.equal(me.status, 200, 'GET /auth/me 200s with a session');
    assert.equal(JSON.parse(me.text).workspace.id, 'owner');
    const profile = await get(port, '/workspaces/me', cookie);
    assert.equal(profile.status, 200, 'GET /workspaces/me 200s');
    const profileBody = JSON.parse(profile.text);
    assert.ok(!('paypalClientSecret' in profileBody), 'secret never returned');
    assert.ok(!('gmailRefreshToken' in profileBody), 'token never returned');
    assert.equal(typeof profileBody.gmailConnected, 'boolean');
    const logout = await request(port, 'POST', '/auth/logout', {
      headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 200, 'logout 200s');
    assert.equal(
      (await get(port, '/auth/me', cookie)).status,
      401,
      'session dead after logout',
    );
    console.log('[PASS] adoption + session lifecycle + secret redaction');

    // 3. Second user gets a fresh workspace with seeds + link code.
    const userB = await prisma.user.create({
      data: { googleSub: SUB_B, email: `b-${stamp}@example.com` },
    });
    const wsB = await workspaces.provisionForUser(userB.id, userB.email);
    assert.notEqual(wsB, 'owner', 'second signup provisions fresh');
    const seeds = await prisma.schedule.findMany({
      where: { workspaceId: wsB },
      select: { systemKey: true },
    });
    assert.deepEqual(
      seeds.map((s) => s.systemKey).sort(),
      ['payroll.monthly', 'reminders.invoice-followup'],
      'system schedules seeded per workspace',
    );
    const { token: tokenB } = await sessions.create(userB.id);
    const cookieB = `arkpay_session=${tokenB}`;
    const linkRes = await request(port, 'POST', '/telegram/link-code', {
      headers: { Cookie: cookieB },
    });
    assert.equal(linkRes.status, 200, 'link-code 200s');
    const { linkCode, linked } = JSON.parse(linkRes.text);
    assert.match(linkCode, /^ARKPAY-[A-Z2-9]{6}$/, 'code shape');
    assert.equal(linked, false, 'starts unlinked');
    // Idempotent re-issue.
    const linkRes2 = await request(port, 'POST', '/telegram/link-code', {
      headers: { Cookie: cookieB },
    });
    assert.equal(JSON.parse(linkRes2.text).linkCode, linkCode);
    console.log('[PASS] fresh workspace + seeds + link code');

    // 4. Contacts isolation + per-workspace uniques.
    const contactA = await contacts.findOrCreate(
      { name: CONTACT_NAME, kind: 'SUPPLIER' },
      wsA,
    );
    const contactB = await contacts.findOrCreate(
      { name: CONTACT_NAME, kind: 'SUPPLIER' },
      wsB,
    );
    assert.notEqual(contactA.id, contactB.id, 'same name+kind in two tenants');
    // Same tenant + same name+kind still dedupes.
    const contactA2 = await contacts.findOrCreate(
      { name: CONTACT_NAME, kind: 'SUPPLIER' },
      wsA,
    );
    assert.equal(contactA2.id, contactA.id, 'dedupes within a tenant');
    const listA = await contacts.list(wsA);
    const listB = await contacts.list(wsB);
    assert.ok(listA.some((c) => c.id === contactA.id), 'A lists A');
    assert.ok(!listA.some((c) => c.id === contactB.id), 'A never lists B');
    assert.ok(listB.some((c) => c.id === contactB.id), 'B lists B');
    assert.ok(!listB.some((c) => c.id === contactA.id), 'B never lists A');
    await assert.rejects(
      contacts.getById(contactB.id, wsA),
      /not found/,
      'cross-tenant get refused',
    );
    await assert.rejects(
      contacts.recordPayment(contactB.id, 5, 'USD', wsA),
      /another workspace/,
      'cross-tenant learning refused',
    );
    // HTTP surface respects the session tenant too.
    const httpList = await get(port, '/contacts', cookieB);
    assert.equal(httpList.status, 200, 'GET /contacts 200s');
    const httpIds = JSON.parse(httpList.text).map((c) => c.id);
    assert.ok(httpIds.includes(contactB.id), 'session B sees B');
    assert.ok(!httpIds.includes(contactA.id), 'session B never sees A');
    console.log('[PASS] contacts isolation + uniques + session-scoped HTTP');

    // 5. Telegram pairing state machine.
    const fakeTelegramId = `9${Date.now().toString().slice(-9)}`;
    const linked1 = await workspaces.linkTelegram(linkCode, fakeTelegramId);
    assert.equal(linked1.workspaceId, wsB, 'code links to its workspace');
    assert.equal(
      await workspaces.resolveForTelegram(fakeTelegramId),
      wsB,
      'link resolves the tenant',
    );
    // Re-link is idempotent.
    await workspaces.linkTelegram(linkCode.toLowerCase(), fakeTelegramId);
    await assert.rejects(
      workspaces.linkTelegram('ARKPAY-NOPE00', fakeTelegramId),
      /unknown link code/,
      'unknown code rejected',
    );
    // One Telegram account, one workspace.
    const { linkCode: codeA } = await workspaces.issueLinkCode(wsA);
    await assert.rejects(
      workspaces.linkTelegram(codeA, fakeTelegramId),
      /already linked to another workspace/,
      'double-link refused',
    );
    assert.equal(
      await workspaces.resolveForTelegram('0000000000'),
      null,
      'unlinked id resolves to nothing (fail-closed)',
    );
    console.log('[PASS] Telegram pairing state machine');

    // 6. OAuth URL builders (callbacks stay manual).
    const login = await get(port, '/auth/google');
    assert.equal(login.status, 302, 'login redirects');
    assert.match(
      login.headers.location,
      /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?.*scope=openid/,
      'login URL is a Google OAuth URL',
    );
    const gmail = await get(port, '/auth/gmail/connect', cookieB);
    assert.equal(gmail.status, 302, 'gmail connect redirects');
    assert.match(
      decodeURIComponent(gmail.headers.location),
      /gmail\.readonly/,
      'gmail URL carries the readonly scope',
    );
    assert.match(
      decodeURIComponent(gmail.headers.location),
      /access_type=offline/,
      'gmail URL requests offline access',
    );
    assert.equal(
      (await get(port, '/auth/gmail/connect')).status,
      401,
      'gmail connect requires a session',
    );
    // Bad PayPal credentials are reported, never stored.
    const badPaypal = await request(port, 'PATCH', '/workspaces/me/paypal', {
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'bad',
        clientSecret: 'bad',
        mode: 'sandbox',
      }),
    });
    assert.equal(badPaypal.status, 400, 'bad PayPal creds 400');
    const wsBRow = await prisma.workspace.findUnique({
      where: { id: wsB },
      select: { paypalClientId: true },
    });
    assert.equal(wsBRow.paypalClientId, null, 'rejected creds not stored');
    console.log('[PASS] OAuth builders + PayPal probe rejection');

    // 7. 10b: action isolation + execution tenant checks.
    const { token: tokenA2 } = await sessions.create(userA.id);
    const cookieA = `arkpay_session=${tokenA2}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const mkAction = (workspaceId, tag) =>
      prisma.action.create({
        data: {
          workspaceId,
          type: 'PAYOUT_SINGLE',
          payeeName: `Tenancy Payee ${stamp}`,
          payeePaypal: `tenancy-payee-${stamp}@example.com`,
          amount: '5.00',
          currency: 'USD',
          purpose: `tenancy-probe-${stamp}-${tag}`,
          actionHash: `tenancy-${stamp}-${tag}`,
          idempotencyKey: `tenancy-${stamp}-${tag}`,
          extractedJson: {},
          expiresAt,
        },
      });
    const actionA = await mkAction(wsA, 'a');
    const actionB = await mkAction(wsB, 'b');
    const approvalsB = await get(port, '/approvals?limit=100', cookieB);
    const approvalsBIds = JSON.parse(approvalsB.text).rows.map((r) => r.id);
    assert.ok(approvalsBIds.includes(actionB.id), 'B lists own action');
    assert.ok(!approvalsBIds.includes(actionA.id), 'B never lists A action');
    const approvalsA = await get(port, '/approvals?limit=100', cookieA);
    const approvalsAIds = JSON.parse(approvalsA.text).rows.map((r) => r.id);
    assert.ok(approvalsAIds.includes(actionA.id), 'A lists own action');
    assert.ok(!approvalsAIds.includes(actionB.id), 'A never lists B action');
    const execCross = await request(port, 'POST', `/approvals/${actionA.id}/execute`, {
      headers: { Cookie: cookieB },
    });
    assert.deepEqual(
      JSON.parse(execCross.text),
      { ok: false, reason: 'not_found' },
      'cross-tenant execute sees not_found',
    );
    const traceCross = await get(port, `/audit/actions/${actionB.id}`, cookieA);
    assert.ok(
      traceCross.text === '' || traceCross.text === 'null',
      'cross-tenant trace is empty',
    );
    console.log('[PASS] action isolation + execution checks');

    // 8. 10b+10d: decision tenant gate (link identity, no approver id).
    // Section 5 linked B's code to a fake id — that link IS the identity.
    const crossTap = await decision.decide(
      actionA.id,
      'approve',
      fakeTelegramId,
    );
    assert.deepEqual(
      crossTap,
      { ok: false, reason: 'not_found' },
      'foreign tap sees not_found',
    );
    const ownTap = await decision.decide(actionB.id, 'approve', fakeTelegramId);
    assert.equal(ownTap.ok, true, 'own tap still approves');
    assert.equal(ownTap.status, 'APPROVED', 'status flips');
    const strangerTap = await decision.decide(
      actionB.id,
      'approve',
      '0000000000',
    );
    assert.deepEqual(
      strangerTap,
      { ok: false, reason: 'forbidden' },
      'unlinked tapper is forbidden',
    );
    console.log('[PASS] decision gate blocks foreign taps, allows own');

    // 9. 10b: safety history is per-tenant (no cross-tenant duplicates).
    // Asymmetric history: a $7 action exists only in A.
    await prisma.action.create({
      data: {
        workspaceId: wsA,
        type: 'PAYOUT_SINGLE',
        payeeName: `Tenancy Payee ${stamp}`,
        payeePaypal: `tenancy-payee-${stamp}@example.com`,
        amount: '7.00',
        currency: 'USD',
        purpose: `tenancy-probe-${stamp}-a2`,
        actionHash: `tenancy-${stamp}-a2`,
        idempotencyKey: `tenancy-${stamp}-a2`,
        extractedJson: {},
        expiresAt,
      },
    });
    const dupProbe = (workspaceId) =>
      safety.evaluateCreation({
        workspaceId,
        type: 'PAYOUT_SINGLE',
        payeeName: `Tenancy Payee ${stamp}`,
        payeePaypal: `tenancy-payee-${stamp}@example.com`,
        amount: '7.00',
        currency: 'USD',
        purpose: `tenancy-probe-${stamp}-dupcheck`,
      });
    const verdictB = await dupProbe(wsB);
    assert.ok(
      !verdictB.flags.includes('DUPLICATE'),
      'B is not haunted by A-only action',
    );
    const verdictA = await dupProbe(wsA);
    assert.ok(
      verdictA.flags.includes('DUPLICATE'),
      'A still detects its own duplicate',
    );
    console.log('[PASS] per-tenant safety history');

    // 10. 10b: schedule + payroll HTTP isolation.
    const schedCreate = await request(port, 'POST', '/schedules', {
      headers: { Cookie: cookieB, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Tenancy Probe ${stamp}`,
        detail: 'tenancy isolation probe (deleted after the run)',
        kind: 'NOOP',
        trigger: 'INTERVAL',
        intervalMinutes: 60,
      }),
    });
    assert.equal(schedCreate.status, 201, 'schedule create 201s');
    const schedId = JSON.parse(schedCreate.text).id;
    const schedListA = await get(port, '/schedules', cookieA);
    const schedIdsA = JSON.parse(schedListA.text).map((s) => s.id);
    assert.ok(!schedIdsA.includes(schedId), 'A never lists B schedule');
    const schedCross = await get(port, `/schedules/${schedId}`, cookieA);
    assert.ok(
      schedCross.text === '' || schedCross.text === 'null',
      'cross-tenant schedule get is empty',
    );
    await prisma.payrollRun.create({
      data: {
        workspaceId: wsB,
        period: '2099-01',
        batchId: `tenancy-${stamp}`,
        totalAmount: '0.00',
        currency: 'USD',
      },
    });
    const payrollA = await get(port, '/payroll', cookieA);
    const periodsA = JSON.parse(payrollA.text).map((r) => r.period);
    assert.ok(!periodsA.includes('2099-01'), 'A never lists B payroll');
    const payrollCross = await get(port, '/payroll/2099-01', cookieA);
    assert.ok(
      payrollCross.text === '' || payrollCross.text === 'null',
      'cross-tenant payroll is empty',
    );
    console.log('[PASS] schedule + payroll HTTP isolation');

    // 11. 10d: fail-closed Telegram for unlinked workspaces (no transport).
    // wsA (owner) never linked in this run — cards skip, nothing is sent.
    const unlinkedAction = await mkAction(wsA, `unlinked-${stamp}`);
    const skipped = await telegram.sendDecisionCard(unlinkedAction.id);
    assert.equal(skipped, 0, 'unlinked card returns 0 (no message)');
    const skipAudit = await prisma.auditLog.findFirst({
      where: { actionId: unlinkedAction.id, event: 'CARD_SKIPPED' },
    });
    assert.ok(skipAudit, 'CARD_SKIPPED audited');
    await telegram.sendMessage('tenancy-probe-ping', wsA);
    await telegram.sendActionMessage(unlinkedAction.id, 'tenancy-probe-ping');
    console.log('[PASS] unlinked workspaces get no card, no leak');

    // 12. 10d: NOT NULL tenants — every writer table enforces workspaceId.
    const nullable = await prisma.$queryRaw`
      SELECT "table_name" AS "table"
      FROM "information_schema"."columns"
      WHERE "column_name" = 'workspaceId' AND "is_nullable" = 'YES'
      ORDER BY 1
    `;
    assert.deepEqual(
      nullable.map((r) => r.table),
      ['ProcessedWebhook'],
      'only attribution-only ProcessedWebhook stays nullable',
    );
    await assert.rejects(
      () =>
        prisma.action.create({
          data: {
            type: 'PAYOUT_SINGLE',
            payeeName: 'x',
            payeePaypal: 'x@example.com',
            amount: '1.00',
            currency: 'USD',
            purpose: 'tenancy-probe-nullws',
            actionHash: `tenancy-nullws-${stamp}`,
            idempotencyKey: `tenancy-nullws-${stamp}`,
            extractedJson: {},
            expiresAt,
          },
        }),
      /Argument `workspace` is missing/,
      'tenantless action rejected',
    );
    console.log('[PASS] NOT NULL tenants enforced');

    // 13. 10d: strict PayPal — unconnected workspaces fail before any call.
    await assert.rejects(
      () => paypalAuth.context(wsB),
      /not connected/,
      'unconnected workspace rejected without a PayPal call',
    );
    console.log('[PASS] strict per-workspace PayPal credentials');

    console.log('Tenancy gate: ALL GREEN');
  } finally {
    await cleanup(prisma).catch((e) => {
      console.error('cleanup failed:', e instanceof Error ? e.message : e);
    });
    // The bot is never launched here, so its shutdown hook throws
    // "Bot is not running!" — a teardown artifact, not a test failure.
    await app.close().catch((e) => {
      if (!String(e?.message ?? e).includes('Bot is not running')) throw e;
    });
  }
})().catch((e) => {
  console.error('FAIL:', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
