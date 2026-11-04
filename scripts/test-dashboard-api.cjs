#!/usr/bin/env node
/**
 * Dashboard API gate: backend-review fixes + the four API gaps.
 * - CORS preflight + credentialed origin from the shared app config
 * - payout-item attribution by PayPal ref (not the internal batch id)
 * - POST /approvals/:id/ignore (own, foreign, handled, expired)
 * - GET /payouts/:id (own, foreign, wrong-type, no-ref live merge)
 * - safety policy versions (defaults, override, enforcement, history, reset)
 * - POST /invoices + POST /payouts (create, duplicate key, 400s, block path)
 * - guard 401s on every new route
 *
 * Boots the real HTTP app on an ephemeral port with the shared configureApp
 * (what ships). Cards never leave the box: test workspaces are forcibly
 * unlinked for the run (prior links restored afterwards).
 *
 * Run: pnpm --filter @arkpay/api test:dashboard-api
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/app.module');
const { configureApp } = require('../apps/api/dist/app-config');
const { PrismaService } = require('../apps/api/dist/prisma/prisma.service');
const {
  SessionService,
} = require('../apps/api/dist/auth/session.service');
const {
  WorkspacesService,
} = require('../apps/api/dist/auth/workspaces.service');
const {
  PaypalWebhooksService,
} = require('../apps/api/dist/paypal/webhooks/webhooks.service');

const stamp = Date.now().toString(36);
const SUB_A = `dashapi-a-${stamp}`;
const SUB_B = `dashapi-b-${stamp}`;
const TAG = `dashapi-${stamp}`;

function request(port, method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, json, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const authed =
  (cookie) =>
  (extra = {}) =>
    cookie ? { ...extra, Cookie: cookie } : extra;

function json(port, method, path, obj, headers = {}) {
  const body = JSON.stringify(obj ?? {});
  return request(port, method, path, {
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const prisma = app.get(PrismaService);
  const sessions = app.get(SessionService);
  const workspaces = app.get(WorkspacesService);
  const webhooks = app.get(PaypalWebhooksService);

  const userIds = [];
  let wsA = null;
  let wsB = null;
  let priorLinks = [];
  const emailed = (tag) => `${TAG}-${tag}@example.com`;

  const cleanup = async () => {
    const probeActions = await prisma.action.findMany({
      where: { idempotencyKey: { startsWith: `${TAG}-` } },
      select: { id: true },
    });
    const probeIds = probeActions.map((a) => a.id);
    await prisma.auditLog.deleteMany({
      where: { actionId: { in: probeIds } },
    });
    await prisma.action.deleteMany({ where: { id: { in: probeIds } } });
    await prisma.contact.deleteMany({
      where: { paypalEmail: { contains: `${TAG}-` } },
    });
    for (const ws of [wsA, wsB].filter(Boolean)) {
      await prisma.safetyPolicy.deleteMany({ where: { workspaceId: ws } });
      await prisma.telegramLink.deleteMany({ where: { workspaceId: ws } });
    }
    for (const link of priorLinks) {
      await prisma.telegramLink.create({
        data: {
          workspaceId: link.workspaceId,
          linkCode: link.linkCode,
          telegramId: link.telegramId,
          linkedAt: link.linkedAt,
        },
      });
    }
    priorLinks = [];
    await prisma.workspace.updateMany({
      where: { ownerId: { in: userIds } },
      data: { ownerId: null },
    });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  };

  try {
    // Preamble: two users, two sessions, two workspaces.
    for (const sub of [SUB_A, SUB_B]) {
      const user = await prisma.user.create({
        data: { googleSub: sub, email: `${sub}@example.com` },
      });
      userIds.push(user.id);
    }
    wsA = await workspaces.provisionForUser(userIds[0], `${SUB_A}@example.com`);
    wsB = await workspaces.provisionForUser(userIds[1], `${SUB_B}@example.com`);
    assert.notEqual(wsA, wsB, 'test users land in different workspaces');
    const { token: tokenA } = await sessions.create(userIds[0]);
    const { token: tokenB } = await sessions.create(userIds[1]);
    const cookieA = `arkpay_session=${tokenA}`;
    const cookieB = `arkpay_session=${tokenB}`;
    const withA = authed(cookieA);
    const withB = authed(cookieB);

    // Cards stay in the box: stash + drop any links on the test workspaces.
    priorLinks = await prisma.telegramLink.findMany({
      where: { workspaceId: { in: [wsA, wsB] } },
    });
    await prisma.telegramLink.deleteMany({
      where: { workspaceId: { in: [wsA, wsB] } },
    });

    const mkAction = (workspaceId, tag, overrides = {}) =>
      prisma.action.create({
        data: {
          workspaceId,
          type: 'INVOICE',
          payeeName: `${TAG} ${tag}`,
          payeePaypal: emailed(tag),
          amount: '10.00',
          currency: 'USD',
          purpose: `${TAG}-probe-${tag}`,
          actionHash: `${TAG}-hash-${tag}`,
          idempotencyKey: `${TAG}-${tag}`,
          extractedJson: {},
          expiresAt: new Date(Date.now() + 15 * 60_000),
          ...overrides,
        },
      });

    // 1. CORS: preflight + simple request carry the dashboard origin.
    const origin = (
      process.env.WEB_APP_URL ?? 'http://localhost:3000'
    ).split(',')[0];
    const preflight = await request(port, 'OPTIONS', '/approvals', {
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 204, 'preflight 204s');
    assert.equal(
      preflight.headers['access-control-allow-origin'],
      origin,
      'preflight allows the dashboard origin',
    );
    assert.equal(
      preflight.headers['access-control-allow-credentials'],
      'true',
      'preflight allows credentials',
    );
    const simple = await request(port, 'GET', '/auth/me', {
      headers: { Origin: origin },
    });
    assert.equal(
      simple.headers['access-control-allow-origin'],
      origin,
      'simple request allows the dashboard origin',
    );
    console.log('[PASS] CORS allows the dashboard origin with credentials');

    // 2. Payout-item attribution matches the PayPal ref, not our batch id.
    const itemAction = await mkAction(wsA, 'itemattr', {
      type: 'PAYOUT_SINGLE',
      batchId: `${TAG}-internal-batch`,
      paypalRef: `${TAG}-paypal-batch`.toUpperCase(),
    });
    assert.ok(itemAction.id);
    const attributed = await webhooks.findMemberWorkspace(
      `${TAG}-paypal-batch`.toUpperCase(),
    );
    assert.equal(
      attributed?.workspaceId,
      wsA,
      'PayPal batch id resolves the executing tenant',
    );
    const missed = await webhooks.findMemberWorkspace(`${TAG}-internal-batch`);
    assert.equal(missed, null, 'internal batch id matches nothing inbound');
    console.log('[PASS] payout-item attribution uses the PayPal ref');

    // 3. Ignore: own, repeat, foreign, expired.
    const pending = await mkAction(wsA, 'ignore-me');
    const ignored = await json(
      port,
      'POST',
      `/approvals/${pending.id}/ignore`,
      {},
      withA(),
    );
    assert.equal(ignored.status, 201, 'ignore 201s');
    assert.deepEqual(
      { ok: ignored.json.ok, status: ignored.json.status },
      { ok: true, status: 'IGNORED' },
      'own pending action ignored',
    );
    const repeat = await json(
      port,
      'POST',
      `/approvals/${pending.id}/ignore`,
      {},
      withA(),
    );
    assert.equal(repeat.json.reason, 'already_handled', 'repeat is handled');
    const foreignPending = await mkAction(wsB, 'ignore-foreign');
    const foreign = await json(
      port,
      'POST',
      `/approvals/${foreignPending.id}/ignore`,
      {},
      withA(),
    );
    assert.equal(foreign.json.reason, 'not_found', 'foreign ignore 404s');
    const stale = await mkAction(wsA, 'ignore-stale', {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const expired = await json(
      port,
      'POST',
      `/approvals/${stale.id}/ignore`,
      {},
      withA(),
    );
    assert.equal(expired.json.reason, 'expired', 'stale ignore expires');
    console.log('[PASS] dashboard ignore mirrors the tap machine');

    // 4. Payout detail: own, foreign, wrong type.
    const payout = await mkAction(wsA, 'payout-detail', {
      type: 'PAYOUT_SINGLE',
    });
    const detail = await request(port, 'GET', `/payouts/${payout.id}`, {
      headers: withA(),
    });
    assert.equal(detail.status, 200, 'own payout detail 200s');
    assert.equal(detail.json.action.id, payout.id, 'action returned');
    assert.equal(
      detail.json.paypal.available,
      false,
      'unsent payout has no live PayPal state',
    );
    assert.ok(Array.isArray(detail.json.webhookEvents), 'webhook trail');
    const foreignDetail = await request(
      port,
      'GET',
      `/payouts/${foreignPending.id}`,
      { headers: withB() },
    );
    assert.equal(
      foreignDetail.status,
      404,
      'wrong-type id 404s on payout detail',
    );
    const crossDetail = await request(port, 'GET', `/payouts/${payout.id}`, {
      headers: withB(),
    });
    assert.equal(crossDetail.status, 404, 'foreign payout detail 404s');
    console.log('[PASS] payout detail is tenant-scoped');

    // 5. Policy versions: defaults → override → enforcement → history → reset.
    const base = await request(port, 'GET', '/safety/policy', {
      headers: withA(),
    });
    assert.equal(base.status, 200, 'policy 200s');
    assert.equal(base.json.overridden, false, 'no overrides yet');
    assert.equal(base.json.overrideVersion, null, 'no override version');
    const baseVersion = base.json.version;
    const v1 = await json(
      port,
      'POST',
      '/safety/policies',
      { vendorDailyCap: 1 },
      withA(),
    );
    assert.equal(v1.status, 201, 'override saves');
    assert.equal(v1.json.version, 1, 'first version is 1');
    const effective = await request(port, 'GET', '/safety/policy', {
      headers: withA(),
    });
    assert.equal(
      effective.json.config.vendorDailyCap,
      1,
      'override is effective',
    );
    assert.equal(
      effective.json.version,
      `${baseVersion}+w1`,
      'effective stamp records the override',
    );
    const other = await request(port, 'GET', '/safety/policy', {
      headers: withB(),
    });
    assert.equal(
      other.json.overridden,
      false,
      'overrides do not leak across workspaces',
    );
    // Enforcement: a 100 payout over the 1 cap blocks at Gate 1.
    const overCap = await json(
      port,
      'POST',
      '/payouts',
      {
        payeeName: `${TAG} capped`,
        payeeEmail: emailed('capped'),
        amount: '100.00',
        currency: 'USD',
        purpose: `${TAG} over-cap probe`,
        idempotencyKey: `${TAG}-overcap`,
      },
      withA(),
    );
    assert.equal(overCap.status, 201, 'over-cap create answers');
    assert.equal(overCap.json.blocked, true, 'over-cap payout blocked');
    const blockedRow = await prisma.action.findUnique({
      where: { id: overCap.json.actionId },
    });
    assert.equal(blockedRow.status, 'BLOCKED', 'blocked persisted');
    assert.equal(
      blockedRow.policyVersion,
      `${baseVersion}+w1`,
      'verdict keeps the evaluating stamp',
    );
    const badKeys = await json(
      port,
      'POST',
      '/safety/policies',
      { nope: 1 },
      withA(),
    );
    assert.equal(badKeys.status, 400, 'unknown policy key 400s');
    const negative = await json(
      port,
      'POST',
      '/safety/policies',
      { vendorDailyCap: -5 },
      withA(),
    );
    assert.equal(negative.status, 400, 'negative cap 400s');
    const v2 = await json(
      port,
      'POST',
      '/safety/policies',
      { globalDailyCap: 2 },
      withA(),
    );
    assert.equal(v2.json.version, 2, 'second version is 2');
    const history = await request(port, 'GET', '/safety/policies', {
      headers: withA(),
    });
    assert.deepEqual(
      history.json.map((r) => r.version),
      [2, 1],
      'history newest-first',
    );
    const reset = await request(port, 'DELETE', '/safety/policies', {
      headers: withA(),
    });
    assert.equal(reset.status, 200, 'reset 200s');
    const afterReset = await request(port, 'GET', '/safety/policy', {
      headers: withA(),
    });
    assert.equal(afterReset.json.overridden, false, 'reset clears overrides');
    console.log('[PASS] policy versions + enforcement + reset');

    // 6. Creates: invoice + payout, duplicates, 400s, block path honesty.
    const invoice = await json(
      port,
      'POST',
      '/invoices',
      {
        payeeName: `${TAG} client`,
        payeeEmail: emailed('client'),
        amount: '450.00',
        currency: 'usd',
        purpose: `${TAG} website invoice`,
        idempotencyKey: `${TAG}-invoice-1`,
      },
      withA(),
    );
    assert.equal(invoice.status, 201, 'invoice create 201s');
    assert.equal(invoice.json.ok, true, 'invoice draft ok');
    assert.equal(invoice.json.duplicate, false, 'first create is fresh');
    assert.equal(
      invoice.json.cardSent,
      false,
      'unlinked workspace reports no card (fail-closed)',
    );
    assert.ok(
      invoice.json.actionUrl.endsWith(invoice.json.actionId),
      'actionUrl points at the action',
    );
    const stored = await prisma.action.findUnique({
      where: { id: invoice.json.actionId },
    });
    assert.equal(stored.currency, 'USD', 'currency normalized');
    const dup = await json(
      port,
      'POST',
      '/invoices',
      {
        payeeName: `${TAG} client`,
        payeeEmail: emailed('client'),
        amount: '450.00',
        currency: 'USD',
        purpose: `${TAG} website invoice`,
        idempotencyKey: `${TAG}-invoice-1`,
      },
      withA(),
    );
    assert.equal(dup.json.duplicate, true, 'same key replays');
    assert.equal(
      dup.json.actionId,
      invoice.json.actionId,
      'replay returns the same action',
    );
    const clash = await json(
      port,
      'POST',
      '/invoices',
      {
        payeeName: `${TAG} other`,
        payeeEmail: emailed('other'),
        amount: '1.00',
        currency: 'USD',
        purpose: `${TAG} clash probe`,
        idempotencyKey: `${TAG}-invoice-1`,
      },
      withB(),
    );
    assert.equal(clash.status, 409, 'foreign key use conflicts');
    for (const [label, patch] of [
      ['bad email', { payeeEmail: 'not-an-email' }],
      ['bad amount', { amount: '12.345' }],
      ['bad currency', { currency: 'US' }],
      ['missing purpose', { purpose: '' }],
    ]) {
      const bad = await json(
        port,
        'POST',
        '/invoices',
        {
          payeeName: `${TAG} bad`,
          payeeEmail: emailed('bad'),
          amount: '1.00',
          currency: 'USD',
          purpose: `${TAG} bad probe`,
          ...patch,
        },
        withA(),
      );
      assert.equal(bad.status, 400, `${label} 400s`);
    }
    const payoutCreate = await json(
      port,
      'POST',
      '/payouts',
      {
        payeeName: `${TAG} staffer`,
        payeeEmail: emailed('staffer'),
        amount: '25.00',
        currency: 'USD',
        purpose: `${TAG} staff payout`,
        contactKind: 'STAFF',
        idempotencyKey: `${TAG}-payout-1`,
      },
      withA(),
    );
    assert.equal(payoutCreate.status, 201, 'payout create 201s');
    const staffContact = await prisma.contact.findFirst({
      where: { paypalEmail: emailed('staffer') },
    });
    assert.equal(staffContact.kind, 'STAFF', 'staff kind honored');
    console.log('[PASS] dashboard creates + idempotency + validation');

    // 7. Guard: every new route 401s without a session.
    const unauth = [
      ['POST', '/invoices'],
      ['POST', '/payouts'],
      ['POST', `/approvals/${payout.id}/ignore`],
      ['GET', `/payouts/${payout.id}`],
      ['GET', '/safety/policy'],
      ['GET', '/safety/policies'],
      ['POST', '/safety/policies'],
      ['DELETE', '/safety/policies'],
    ];
    for (const [method, path] of unauth) {
      assert.equal(
        (await request(port, method, path)).status,
        401,
        `${method} ${path} 401s`,
      );
    }
    console.log('[PASS] new routes are session-guarded');

    console.log('Dashboard API gate: ALL GREEN');
  } finally {
    await cleanup().catch((e) => {
      console.error('cleanup failed:', e.message);
    });
    await app.close().catch((e) => {
      if (!String(e?.message ?? e).includes('Bot is not running')) throw e;
    });
  }
}

main().catch((e) => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
