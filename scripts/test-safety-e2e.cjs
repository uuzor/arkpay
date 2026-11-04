#!/usr/bin/env node
/**
 * Phase 8 end-to-end fraud check.
 *
 * 1) A known payee claims a new PayPal email through the REAL email pipeline
 *    (LLM extraction → contacts → Safety Gate 1) and must end up BLOCKED with
 *    an audit entry and no approval card.
 * 2) The same changed-payee action goes through Gate 2 execution and must be
 *    refused before any PayPal service is called.
 *
 * Run after `pnpm --filter @arkpay/api build`:
 *   pnpm --filter @arkpay/api exec dotenv -e ../../.env -- \
 *     node ../../scripts/test-safety-e2e.cjs
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const {
  OpenAiCompatibleProvider,
} = require('../apps/api/dist/llm/openai-compatible.provider');
const { LlmService } = require('../apps/api/dist/llm/llm.service');
const { ContactsService } = require('../apps/api/dist/contacts/contacts.service');
const { AuditService } = require('../apps/api/dist/audit/audit.service');
const { SafetyService } = require('../apps/api/dist/safety/safety.service');
const { PipelineService } = require('../apps/api/dist/pipeline/pipeline.service');
const {
  ApprovalsService,
} = require('../apps/api/dist/approvals/approvals.service');
const {
  computeActionHash,
} = require('../apps/api/dist/approvals/action-hash');

const prisma = new PrismaClient();
const config = new ConfigService();
const audit = new AuditService(prisma);
const safety = new SafetyService(prisma, config, audit);
const contacts = new ContactsService(prisma);

const sent = [];
const telegram = {
  sendDecisionCard: async () => {
    sent.push({ kind: 'card' });
    return 1;
  },
  sendBlockedNotice: async (_id, reasons) => {
    sent.push({ kind: 'blocked', reasons });
    return 1;
  },
  sendMessage: async () => {},
  sendDocument: async () => {},
};

const stamp = Date.now();
const contactName = `Acme Fraud Demo ${stamp}`;
const oldEmail = `old-${stamp}@acme-fraud.test`;
const newEmail = `new-${stamp}@attacker.test`;
const gmailId = `safety-e2e-${stamp}`;
let emailId;
let actionId;
let gate2Id;
let touchedLinkCode = null;

async function cleanup() {
  const ids = [actionId, gate2Id].filter(Boolean);
  for (const id of ids) {
    await prisma.auditLog.deleteMany({ where: { actionId: id } });
    await prisma.action.deleteMany({ where: { id } });
  }
  if (emailId) await prisma.email.deleteMany({ where: { id: emailId } });
  await prisma.contact.deleteMany({ where: { name: contactName } });
  await prisma.telegramLink.deleteMany({
    where: { linkCode: { startsWith: 'SAFETY-E2E-' } },
  });
  // Restore a pending owner pairing code we borrowed, plus self-heal a
  // crashed run's leftover fake id.
  if (touchedLinkCode) {
    await prisma.telegramLink.updateMany({
      where: { linkCode: touchedLinkCode },
      data: { telegramId: null, linkedAt: null },
    });
    touchedLinkCode = null;
  }
  await prisma.telegramLink.updateMany({
    where: {
      workspaceId: 'owner',
      telegramId: { startsWith: 'safety-e2e-' },
    },
    data: { telegramId: null, linkedAt: null },
  });
}

(async () => {
  // Self-healing preamble: a crashed run must not poison the next one.
  await cleanup();
  try {
    const contact = await prisma.contact.create({
      data: {
        workspaceId: 'owner',
        name: contactName,
        paypalEmail: oldEmail,
        kind: 'SUPPLIER',
        usualAmount: '100.00',
        currency: 'USD',
        payCount: 5,
        lastPaidAt: new Date(Date.now() - 7 * 86_400_000),
      },
    });

    const email = await prisma.email.create({
      data: {
        workspaceId: 'owner',
        gmailId,
        from: `billing@acme-fraud.test`,
        subject: 'Updated PayPal details',
        body:
          `Hi, this is ${contactName}. Our PayPal email has changed. ` +
          `Please pay the outstanding 100.00 USD for September hosting to our ` +
          `new PayPal address: ${newEmail}. This is urgent, please send it today.`,
        status: 'NEW',
        receivedAt: new Date(),
      },
    });
    emailId = email.id;

    const llm = new LlmService(
      prisma,
      config,
      new OpenAiCompatibleProvider(config),
    );
    const pipeline = new PipelineService(
      prisma,
      config,
      llm,
      contacts,
      telegram,
      safety,
    );

    // Targeted: the shared dev inbox may hold other NEW mail, so run the
    // real per-email path directly instead of claiming the queue head.
    const outcome = await pipeline.processOne(email);
    assert.equal(outcome, 'blocked', 'fraud email blocked through the pipeline');

    const blocked = await prisma.action.findFirst({
      where: { emailId: email.id },
      include: { audit: { orderBy: { createdAt: 'asc' } } },
    });
    assert.ok(blocked, 'pipeline created an action row');
    actionId = blocked.id;
    assert.equal(blocked.status, 'BLOCKED', 'Gate 1 blocked the changed payee');
    assert.equal(blocked.policyVerdict, 'BLOCK');
    assert.ok(
      blocked.riskFlags.includes('PAYEE_CHANGED'),
      `PAYEE_CHANGED persisted (${blocked.riskFlags.join(', ')})`,
    );
    assert.ok(
      blocked.audit.some((row) => row.event === 'BLOCKED'),
      'BLOCKED audit entry exists',
    );
    assert.ok(
      blocked.audit.some((row) => row.event === 'SAFETY_EVALUATED'),
      'SAFETY_EVALUATED audit entry exists',
    );
    assert.equal(sent.at(-1)?.kind, 'blocked', 'no approval card was sent');
    assert.equal(sent.at(-1)?.reasons?.length > 0, true, 'block reasons shown');
    assert.equal(contact.paypalEmail, oldEmail, 'contact record was not overwritten');

    console.log('[PASS] Gate 1 blocked the fraud email through the real pipeline');
    console.log(`       action=${blocked.id} flags=${blocked.riskFlags.join(',')}`);
    console.log(`       summary=${blocked.safetySummary}`);

    // Render the real Telegram notice with a fake transport: the visible
    // label is part of the acceptance criterion.
    const { TelegramService } = require('../apps/api/dist/telegram/telegram.service');
    const notices = [];
    const fakeBot = {
      telegram: {
        sendMessage: async (_chatId, text) => {
          notices.push(text);
          return { message_id: 9001 };
        },
        sendDocument: async () => {},
      },
    };
    // Fail-closed routing needs a linked chat: ensure the owner has one
    // (fake id, fake transport — nothing leaves the box).
    const ownerLink = await prisma.telegramLink.findFirst({
      where: { workspaceId: 'owner' },
    });
    if (!ownerLink) {
      await prisma.telegramLink.create({
        data: {
          workspaceId: 'owner',
          linkCode: `SAFETY-E2E-${stamp}`,
          telegramId: `safety-e2e-${stamp}`,
          linkedAt: new Date(),
        },
      });
    } else if (!ownerLink.telegramId) {
      touchedLinkCode = ownerLink.linkCode;
      await prisma.telegramLink.update({
        where: { linkCode: ownerLink.linkCode },
        data: { telegramId: `safety-e2e-${stamp}`, linkedAt: new Date() },
      });
    }
    const telegramService = new TelegramService(fakeBot, prisma, audit);
    await telegramService.sendBlockedNotice(blocked.id, [
      'the PayPal email differs from the known payee record',
    ]);
    assert.match(notices.at(-1), /Blocked by the Payment Safety Engine/);
    assert.match(notices.at(-1), /No money moved/);
    assert.match(notices.at(-1), /PayPal email differs/);
    console.log('[PASS] Telegram blocked notice has the visible label and no buttons');

    // ---- Gate 2: a row already APPROVED still cannot execute ----
    const idempotencyKey = randomUUID();
    const amount = '100.00';
    const purpose = 'Changed-payee gate 2 test';
    const actionHash = computeActionHash({
      payeeName: contactName,
      payeePaypal: newEmail,
      amount,
      currency: 'USD',
      purpose,
      idempotencyKey,
    });
    const gate2 = await prisma.action.create({
      data: {
        workspaceId: 'owner',
        type: 'PAYOUT_SINGLE',
        status: 'APPROVED',
        contactId: contact.id,
        payeeName: contactName,
        payeePaypal: newEmail,
        amount,
        currency: 'USD',
        purpose,
        extractedJson: { test: 'safety-gate-2' },
        riskFlags: ['PAYEE_CHANGED'],
        policyVersion: blocked.policyVersion,
        policyVerdict: 'NEEDS_CONFIRMATION',
        safetySummary: blocked.safetySummary,
        confidence: 0.9,
        actionHash,
        idempotencyKey,
        version: 1,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        approvedBy: config.get('TELEGRAM_APPROVER_ID') ?? null,
        approvedAt: new Date(),
      },
    });
    gate2Id = gate2.id;
    await prisma.auditLog.create({
      data: {
        actionId: gate2.id,
        event: 'APPROVED',
        detail: { version: 1, via: 'test-safety-e2e' },
      },
    });

    let paypalCalled = false;
    const fakeInvoices = {
      createDraftInvoice: async () => {
        paypalCalled = true;
        throw new Error('PayPal must not be called');
      },
      getInvoice: async () => {
        paypalCalled = true;
        throw new Error('PayPal must not be called');
      },
    };
    const fakePayouts = {
      createPayout: async () => {
        paypalCalled = true;
        throw new Error('PayPal must not be called');
      },
      getPayoutBatch: async () => {
        paypalCalled = true;
        throw new Error('PayPal must not be called');
      },
    };
    const approvals = new ApprovalsService(
      prisma,
      config,
      audit,
      contacts,
      fakeInvoices,
      fakePayouts,
      safety,
    );
    const result = await approvals.executeApprovedAction(gate2.id);
    const after = await prisma.action.findUnique({
      where: { id: gate2.id },
      include: { audit: { orderBy: { createdAt: 'asc' } } },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'blocked');
    assert.equal(after.status, 'BLOCKED');
    assert.equal(paypalCalled, false, 'no PayPal call was made');
    assert.ok(
      after.audit.some(
        (row) =>
          row.event === 'SAFETY_EVALUATED' &&
          row.detail &&
          row.detail.gate === 2,
      ),
      'Gate 2 safety audit exists',
    );
    assert.ok(
      after.audit.some((row) => row.event === 'BLOCKED'),
      'Gate 2 BLOCKED audit exists',
    );

    console.log('[PASS] Gate 2 blocked the approved changed-payee payout');
    console.log(`       reason=${result.detail}`);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})().catch(async (e) => {
  console.error(e);
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
  process.exit(1);
});
