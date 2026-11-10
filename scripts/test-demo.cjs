#!/usr/bin/env node
/**
 * Judge demo gate: DEMO_MODE flag, POST /auth/demo seeding, dashboard
 * approval (demo-only), invoice-live / payout-read-only execution policy,
 * connection-edit refusals, and demo rate limiting.
 *
 * Boots the real HTTP app on an ephemeral port. The demo workspace seeds
 * from the owner's sandbox PayPal credentials (read from the DB, never
 * printed) so one seeded invoice executes live per idempotency key.
 *
 * Run: pnpm --filter @arkpay/api test:demo
 */
const assert = require('node:assert/strict');
const http = require('node:http');

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
    if (body) req.write(body);
    req.end();
  });
}

const json = (r) => {
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
};

async function main() {
  process.env.DEMO_MODE = 'true';
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../apps/api/dist/app.module');
  const {
    PrismaService,
  } = require('../apps/api/dist/prisma/prisma.service');
  const {
    SessionService,
  } = require('../apps/api/dist/auth/session.service');
  const {
    SecretBoxService,
  } = require('../apps/api/dist/common/secret-box.service');
  const {
    DEMO_WORKSPACE_ID,
  } = require('../apps/api/dist/auth/tenant.constants');

  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const prisma = app.get(PrismaService);
  const sessions = app.get(SessionService);
  const secrets = app.get(SecretBoxService);

  // Demo PayPal wiring comes from the owner's sandbox app (server-side).
  const owner = await prisma.workspace.findUnique({
    where: { id: 'owner' },
    select: { paypalClientId: true, paypalClientSecret: true, paypalMode: true },
  });
  assert.ok(
    owner?.paypalClientId && owner?.paypalClientSecret,
    'owner workspace must have PayPal connected for the live demo invoice',
  );
  process.env.DEMO_PAYPAL_CLIENT_ID = owner.paypalClientId;
  process.env.DEMO_PAYPAL_CLIENT_SECRET = secrets.decrypt(
    owner.paypalClientSecret,
  );
  process.env.DEMO_PAYPAL_MODE = owner.paypalMode || 'sandbox';

  try {
    // 1. Mode flag is public.
    let r = await request(port, 'GET', '/auth/mode');
    assert.equal(r.status, 200);
    assert.equal(json(r)?.demoEnabled, true);
    console.log('[PASS] GET /auth/mode reports demoEnabled');

    // 2. Demo login mints a session + seeds the workspace (idempotent).
    r = await request(port, 'POST', '/auth/demo');
    assert.equal(r.status, 200);
    assert.equal(json(r)?.ok, true);
    assert.equal(json(r)?.workspaceId, DEMO_WORKSPACE_ID);
    const cookie = (r.headers['set-cookie'] || []).join(';');
    assert.match(cookie, /arkpay_session=/);
    const demoCookie = { Cookie: cookie };
    const countActions = () =>
      prisma.action.count({ where: { workspaceId: DEMO_WORKSPACE_ID } });
    const before = await countActions();
    assert.ok(before >= 8, `expected >= 8 seeded actions, got ${before}`);
    r = await request(port, 'POST', '/auth/demo');
    assert.equal(r.status, 200);
    assert.equal(await countActions(), before);
    console.log(
      `[PASS] POST /auth/demo seeds once (${before} actions, re-seed stable)`,
    );

    // 3. Session resolves as demo.
    r = await request(port, 'GET', '/auth/me', { headers: demoCookie });
    assert.equal(r.status, 200);
    assert.equal(json(r)?.workspace?.isDemo, true);
    r = await request(port, 'GET', '/workspaces/me', { headers: demoCookie });
    assert.equal(r.status, 200);
    assert.equal(json(r)?.isDemo, true);
    assert.equal(json(r)?.paypalConnected, true);
    console.log('[PASS] demo session resolves with isDemo + PayPal connected');

    // 4. Demo invoice approves (dashboard) + executes LIVE against sandbox.
    const probeKey = 'demo-probe-invoice';
    let probe = await prisma.action.findUnique({
      where: { idempotencyKey: probeKey },
    });
    if (!probe) {
      const {
        computeActionHash,
      } = require('../apps/api/dist/approvals/action-hash');
      probe = await prisma.action.create({
        data: {
          workspaceId: DEMO_WORKSPACE_ID,
          type: 'INVOICE',
          status: 'PENDING_APPROVAL',
          payeeName: 'Demo Probe',
          payeePaypal: 'demo-probe@example.com',
          amount: 1,
          currency: 'USD',
          purpose: 'Demo gate probe invoice',
          extractedJson: { kind: 'INVOICE_REQUEST', confidence: 1 },
          riskFlags: [],
          policyVersion: 'arkpay-policy-2026-11-07',
          policyVerdict: 'ALLOW',
          confidence: 1,
          actionHash: computeActionHash({
            payeeName: 'Demo Probe',
            payeePaypal: 'demo-probe@example.com',
            amount: 1,
            currency: 'USD',
            purpose: 'Demo gate probe invoice',
            idempotencyKey: probeKey,
          }),
          idempotencyKey: probeKey,
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
          version: 1,
        },
      });
    }
    r = await request(port, 'POST', `/approvals/${probe.id}/approve`, {
      headers: demoCookie,
    });
    const approval = json(r);
    assert.ok(
      r.status === 200 || r.status === 201,
      `demo approve returned ${r.status}: ${r.text.slice(0, 200)}`,
    );
    assert.ok(
      approval?.ok || approval?.reason === 'already_handled',
      `unexpected approve result: ${r.text.slice(0, 200)}`,
    );
    r = await request(port, 'POST', `/approvals/${probe.id}/execute`, {
      headers: demoCookie,
    });
    const exec = json(r);
    assert.equal(exec?.ok, true, `demo invoice execute: ${r.text.slice(0, 300)}`);
    assert.match(exec?.paypalRef || '', /^INV2-/);
    console.log(`[PASS] demo invoice approved + executed live (${exec.paypalRef})`);

    // 5. Demo payout approves but execution refuses honestly.
    const payout = await prisma.action.findFirst({
      where: {
        workspaceId: DEMO_WORKSPACE_ID,
        type: 'PAYOUT_SINGLE',
        status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    assert.ok(payout, 'expected a pending/approved demo payout seed');
    r = await request(port, 'POST', `/approvals/${payout.id}/approve`, {
      headers: demoCookie,
    });
    assert.ok(r.status === 200 || r.status === 201);
    r = await request(port, 'POST', `/approvals/${payout.id}/execute`, {
      headers: demoCookie,
    });
    assert.equal(json(r)?.ok, false);
    assert.equal(json(r)?.reason, 'demo_readonly');
    console.log('[PASS] demo payout execution refused with demo_readonly');

    // 6. Dashboard approval is demo-only: a real workspace gets 403.
    const stamp = Date.now().toString(36);
    const user = await prisma.user.create({
      data: {
        googleSub: `demo-gate-${stamp}`,
        email: `demo-gate-${stamp}@example.com`,
      },
    });
    const ws = await prisma.workspace.create({
      data: { ownerId: user.id, name: 'demo gate ws' },
    });
    const { token } = await sessions.create(user.id);
    const realCookie = { Cookie: `arkpay_session=${token}` };
    r = await request(port, 'POST', `/approvals/${probe.id}/approve`, {
      headers: realCookie,
    });
    assert.equal(r.status, 403);
    console.log('[PASS] non-demo dashboard approve returns 403');
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.workspace.delete({ where: { id: ws.id } });
    await prisma.user.delete({ where: { id: user.id } });

    // 7. Demo profile + connection edits refuse.
    r = await request(port, 'PATCH', '/workspaces/me', {
      headers: { ...demoCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    assert.equal(r.status, 400);
    r = await request(port, 'PATCH', '/workspaces/me/paypal', {
      headers: { ...demoCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'x', clientSecret: 'y' }),
    });
    assert.equal(r.status, 400);
    console.log('[PASS] demo profile + PayPal edits refused');

    // 8. Rate limit: 11th demo login within the hour is 429. Runs last —
    // the budget is per-process and this process exits after the gate.
    // (Step 2 already spent 2 of the 10 hourly logins.)
    let last = null;
    for (let i = 0; i < 8; i++) {
      last = await request(port, 'POST', '/auth/demo');
      assert.equal(last.status, 200);
    }
    last = await request(port, 'POST', '/auth/demo');
    assert.equal(last.status, 429);
    console.log('[PASS] 11th demo login in an hour returns 429');

    console.log('Demo gate: ALL GREEN');
  } finally {
    await app.close().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
