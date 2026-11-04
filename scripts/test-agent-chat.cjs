#!/usr/bin/env node
/**
 * Phase 9b gate: agent chat SSE + tool calling + list endpoints.
 *
 * Boots the real HTTP app on an ephemeral port (no poller/scheduler/Telegram
 * launch — those start in main.ts, which this script does not run), then:
 *  1. streams a payout draft through POST /agent/chat and checks the event
 *     sequence, the PENDING_APPROVAL row, and the agent-chat audit origin
 *  2. proves readOnly strips money tools and creates nothing
 *  3. proves JSON + multipart attachments reach the agent
 *  4. exercises every 9b list endpoint incl. cursor round-trips
 *  5. replays chat history via GET /agent/messages
 *
 * Test rows are deleted afterwards. NOTE: step 1 drafts through the real
 * card path — the card goes to the owner workspace's linked chat when one
 * exists, else it is skipped fail-closed (CARD_SKIPPED); the action is
 * deleted, so a tap on any delivered card lands on not_found.
 *
 * All routes are session-guarded: the script adopts the owner workspace for
 * a throwaway user (its rows back every list assertion) and resets adoption
 * afterwards.
 *
 * Run: pnpm --filter @arkpay/api test:agent-chat
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

const startedAt = new Date();
const stamp = Date.now().toString(36);
const SUB = `agentchat-${stamp}`;
const CHAT_NAME = 'Sam Nineb Test';
const CHAT_EMAIL = `sam-9b-${stamp}@example.com`;
const RO_EMAIL = `ro-nobody-${stamp}@example.com`;
const REQUEST_TIMEOUT_MS = 150_000;

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
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`timeout ${method} ${path}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

let sessionCookie = '';
const authed = (headers = {}) =>
  sessionCookie ? { ...headers, Cookie: sessionCookie } : headers;

const get = (port, path) => request(port, 'GET', path, { headers: authed() });

function json(port, method, path, obj) {
  const body = JSON.stringify(obj);
  return request(port, method, path, {
    headers: authed({
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    }),
    body,
  });
}

const postJson = (port, path, obj) => json(port, 'POST', path, obj);
const patchJson = (port, path, obj) => json(port, 'PATCH', path, obj);

function parseSse(text) {
  return text
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => {
      let event = null;
      const dataLines = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      return { event, data: JSON.parse(dataLines.join('\n')) };
    });
}

function multipart(message, userId, fileField, filename, mime, content) {
  const boundary = `----9b${stamp}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\n${message}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="userId"\r\n\r\n${userId}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body,
  };
}

async function cleanup(prisma, userId) {
  for (const email of [CHAT_EMAIL, RO_EMAIL]) {
    const actions = await prisma.action.findMany({
      where: { payeePaypal: email },
    });
    for (const action of actions) {
      await prisma.auditLog.deleteMany({ where: { actionId: action.id } });
      await prisma.action.delete({ where: { id: action.id } });
    }
    await prisma.contact.deleteMany({ where: { paypalEmail: email } });
  }
  await prisma.agentMessage.deleteMany({
    where: { userId: String(userId), createdAt: { gte: startedAt } },
  });
  // Reset adoption so the next run (or gate) starts clean.
  const users = await prisma.user.findMany({
    where: { googleSub: { startsWith: 'agentchat-' } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.workspace.updateMany({
    where: { ownerId: { in: ids } },
    data: { ownerId: null },
  });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

(async () => {
  const userId = process.env.TELEGRAM_APPROVER_ID;
  assert.ok(
    userId && Number.isFinite(Number(userId)),
    'TELEGRAM_APPROVER_ID must be set and numeric (chat-thread id)',
  );
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const prisma = app.get(PrismaService);
  const sessions = app.get(SessionService);
  const workspaces = app.get(WorkspacesService);

  // Self-healing preamble: a crashed run must not poison adoption.
  await cleanup(prisma, userId);
  const user = await prisma.user.create({
    data: { googleSub: SUB, email: `ac-${stamp}@example.com` },
  });
  const ws = await workspaces.provisionForUser(user.id, user.email);
  assert.equal(
    ws,
    'owner',
    'owner workspace must be free for the 9b gate (a real login adopted it)',
  );
  const { token } = await sessions.create(user.id);
  sessionCookie = `arkpay_session=${token}`;

  try {
    // 1. Chat draft flow: stream tokens + request_payout + draft card.
    const chat = await postJson(port, '/agent/chat', {
      userId,
      message: `Pay ${CHAT_NAME} (${CHAT_EMAIL}) $5 for 9b stream test`,
    });
    assert.equal(chat.status, 200, 'POST /agent/chat 200');
    assert.match(
      chat.headers['content-type'] ?? '',
      /text\/event-stream/,
      'SSE content type',
    );
    const events = parseSse(chat.text);
    const byType = (type) => events.filter((e) => e.event === type);
    assert.ok(byType('text-delta').length >= 1, 'streams text-delta');
    const toolCalls = byType('tool-call');
    assert.ok(
      toolCalls.some((e) => e.data.toolName === 'request_payout'),
      `request_payout tool-call streamed (saw: ${toolCalls.map((e) => e.data.toolName).join(', ') || 'none'})`,
    );
    assert.ok(
      byType('tool-result').some((e) => e.data.toolName === 'request_payout'),
      'request_payout tool-result streamed',
    );
    const drafts = byType('draft');
    assert.equal(drafts.length, 1, 'exactly one draft event');
    assert.equal(byType('error').length, 0, 'no error event');
    assert.equal(byType('done').length, 1, 'exactly one done event');
    const draft = drafts[0].data.draft;
    assert.ok(draft.actionId, 'draft carries actionId');
    assert.equal(draft.type, 'PAYOUT_SINGLE');
    const action = await prisma.action.findUnique({
      where: { id: draft.actionId },
    });
    assert.ok(action, 'draft action persisted');
    assert.equal(action.status, 'PENDING_APPROVAL');
    assert.equal(action.payeePaypal, CHAT_EMAIL);
    assert.equal(action.paypalRef, null, 'no money moved');
    const siblings = await prisma.action.findMany({
      where: { payeePaypal: CHAT_EMAIL, createdAt: { gte: startedAt } },
    });
    assert.equal(siblings.length, 1, 'exactly one action created');
    const created = await prisma.auditLog.findFirst({
      where: { actionId: draft.actionId, event: 'CREATED' },
    });
    assert.equal(created?.detail?.via, 'agent-chat', 'audit origin agent-chat');
    console.log(
      '[PASS] chat streams tokens + request_payout + draft; one PENDING_APPROVAL, origin agent-chat',
    );

    // 2. Read-only: money tools stripped, nothing created.
    const before = await prisma.action.count();
    const ro = await postJson(port, '/agent/chat', {
      userId,
      message: `Pay Ro Nobody (${RO_EMAIL}) $3 for ro test`,
      readOnly: true,
    });
    assert.equal(ro.status, 200, 'readOnly chat 200');
    const roEvents = parseSse(ro.text);
    const roTools = roEvents
      .filter((e) => e.event === 'tool-call')
      .map((e) => e.data.toolName);
    for (const banned of [
      'request_payout',
      'create_invoice_draft',
      'follow_up_invoice',
    ]) {
      assert.ok(!roTools.includes(banned), `${banned} absent when readOnly`);
    }
    assert.equal(await prisma.action.count(), before, 'readOnly creates nothing');
    assert.equal(
      roEvents.filter((e) => e.event === 'done').length,
      1,
      'readOnly completes',
    );
    console.log('[PASS] readOnly strips money tools and creates nothing');

    // 3a. JSON attachment reaches the agent and persists in history.
    const note = 'MARKER-9B-NOTE: Ada owes $12 for flyers.';
    const att = await postJson(port, '/agent/chat', {
      userId,
      message: 'Reply with the word RECEIVED and nothing else.',
      attachments: [
        {
          filename: 'note-9b.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from(note).toString('base64'),
        },
      ],
    });
    assert.equal(att.status, 200, 'attachment chat 200');
    const attEvents = parseSse(att.text);
    assert.equal(
      attEvents.filter((e) => e.event === 'error').length,
      0,
      'no error event for attachment',
    );
    assert.equal(
      attEvents.filter((e) => e.event === 'done').length,
      1,
      'attachment chat completes',
    );
    const history = await get(
      port,
      `/agent/messages?userId=${userId}&since=${encodeURIComponent(startedAt.toISOString())}&limit=50`,
    );
    assert.equal(history.status, 200, 'GET /agent/messages 200');
    const turns = JSON.parse(history.text).messages;
    assert.ok(
      turns.some((m) => m.role === 'user' && m.content.includes('note-9b.txt')),
      'attachment prompt persisted in history',
    );
    assert.ok(
      turns.some((m) => m.role === 'user' && m.content.includes('MARKER-9B-NOTE')),
      'attachment text reached the agent',
    );
    assert.ok(
      turns.some((m) => m.role === 'user' && m.content.includes('9b stream test')),
      'draft turn persisted in history',
    );
    assert.ok(
      turns.some((m) => m.role === 'assistant' && m.content.length > 0),
      'assistant reply persisted in history',
    );
    console.log('[PASS] JSON attachment ingested; history replay works');

    // 3b. Multipart upload works too.
    const mp = multipart(
      'Say ok.',
      userId,
      'files',
      'note2-9b.txt',
      'text/plain',
      'hello multipart 9b',
    );
    const mpRes = await request(port, 'POST', '/agent/chat', {
      headers: authed({
        'Content-Type': mp.contentType,
        'Content-Length': mp.body.length,
      }),
      body: mp.body,
    });
    assert.equal(mpRes.status, 200, 'multipart chat 200');
    const mpEvents = parseSse(mpRes.text);
    assert.equal(
      mpEvents.filter((e) => e.event === 'error').length,
      0,
      'no error event for multipart',
    );
    assert.equal(
      mpEvents.filter((e) => e.event === 'done').length,
      1,
      'multipart chat completes',
    );
    console.log('[PASS] multipart attachment ingested');

    // 4. List endpoints with cursor round-trips.
    async function checkPaged(label, path, minRows) {
      const p1 = await get(port, `${path}?limit=1`);
      assert.equal(p1.status, 200, `${label} 200`);
      const b1 = JSON.parse(p1.text);
      assert.ok(Array.isArray(b1.rows), `${label} rows array`);
      assert.ok(b1.rows.length >= minRows, `${label} has rows`);
      assert.ok(b1.rows.length <= 1, `${label} honors limit`);
      assert.equal(typeof b1.totalCount, 'number', `${label} totalCount`);
      if (b1.nextCursor) {
        const p2 = await get(
          port,
          `${path}?limit=1&cursor=${b1.nextCursor}`,
        );
        assert.equal(p2.status, 200, `${label} cursor page 200`);
        const b2 = JSON.parse(p2.text);
        if (b2.rows.length > 0) {
          assert.notEqual(
            b2.rows[0].id,
            b1.rows[0].id,
            `${label} cursor advances`,
          );
        }
      }
      return b1;
    }
    const approvals = await checkPaged('approvals', '/approvals', 1);
    assert.ok(
      approvals.rows[0].id && approvals.rows[0].payeeName,
      'approval row shape',
    );
    const emails = await checkPaged('emails', '/ingest/emails', 1);
    assert.ok(
      typeof emails.rows[0].snippet === 'string' &&
        !('body' in emails.rows[0]),
      'email list carries snippet, not body',
    );
    const emailDetail = await get(port, `/ingest/emails/${emails.rows[0].id}`);
    assert.equal(emailDetail.status, 200, 'email detail 200');
    const emailBody = JSON.parse(emailDetail.text);
    assert.equal(typeof emailBody.body, 'string', 'email detail has body');
    assert.ok(Array.isArray(emailBody.actions), 'email detail has actions');
    const invoices = await checkPaged('invoices', '/invoices', 1);
    const invDetail = await get(port, `/invoices/${invoices.rows[0].id}`);
    assert.equal(invDetail.status, 200, 'invoice detail 200');
    const invBody = JSON.parse(invDetail.text);
    assert.ok(invBody.action && invBody.paypal, 'invoice detail shape');
    assert.ok(Array.isArray(invBody.reminders), 'invoice reminders array');
    await checkPaged('payouts', '/payouts', 1);
    const batches = await get(port, '/payouts/batches');
    assert.equal(batches.status, 200, 'payout batches 200');
    assert.ok(
      Array.isArray(JSON.parse(batches.text).batches),
      'batches array',
    );
    console.log('[PASS] list endpoints 200 with cursor round-trips');

    // 5. Contacts get + patch.
    const contacts = await get(port, '/contacts');
    assert.equal(contacts.status, 200, 'contacts list 200');
    const first = JSON.parse(contacts.text)[0];
    assert.ok(first?.id, 'a contact exists');
    const one = await get(port, `/contacts/${first.id}`);
    assert.equal(one.status, 200, 'contact detail 200');
    assert.ok(
      Array.isArray(JSON.parse(one.text).actions),
      'contact detail has actions',
    );
    const patched = await patchJson(port, `/contacts/${first.id}`, {
      name: first.name,
    });
    assert.equal(patched.status, 200, 'contact patch 200');
    assert.equal(JSON.parse(patched.text).name, first.name, 'patch round-trip');
    console.log('[PASS] contacts get + patch');

    console.log('Phase 9b gate: ALL GREEN');
  } finally {
    await cleanup(prisma, userId).catch((e) => {
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
