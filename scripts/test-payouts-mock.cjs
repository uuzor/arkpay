#!/usr/bin/env node
/**
 * Phase 6 state-machine check with a deterministic PayPal stub.
 *
 * This does NOT replace the sandbox SUCCESS gate. It proves the ArkPay side
 * settles a PayPal SUCCESS batch correctly: single, batch, contact learning,
 * idempotent re-execution. Use the real PayPal path once Payouts is enabled
 * on the sandbox business account.
 */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { AuditService } = require('../apps/api/dist/audit/audit.service');
const { ContactsService } = require('../apps/api/dist/contacts/contacts.service');
const { SafetyService } = require('../apps/api/dist/safety/safety.service');
const {
  ApprovalsService,
} = require('../apps/api/dist/approvals/approvals.service');
const {
  computeActionHash,
} = require('../apps/api/dist/approvals/action-hash');
const {
  toPaypalItemId,
} = require('../apps/api/dist/paypal/paypal-payouts.service');

const prisma = new PrismaClient();
const config = new ConfigService();
const audit = new AuditService(prisma);
const contacts = new ContactsService(prisma);
const safety = new SafetyService(prisma, config, audit);

let mockBatchId = 'MOCK-SINGLE';
let expected = new Map();

const payouts = {
  createPayoutBatch: async (input) => {
    mockBatchId = `MOCK-${randomUUID().slice(0, 8).toUpperCase()}`;
    expected = new Map(
      input.items.map((item) => [
        item.senderItemId,
        { receiver: item.receiver, amount: item.amount },
      ]),
    );
    return { payoutBatchId: mockBatchId, batchStatus: 'PENDING', items: [] };
  },
  waitForTerminalBatch: async () => fullBatch(),
  getPayoutBatch: async () => fullBatch(),
};

function fullBatch() {
  return {
    payoutBatchId: mockBatchId,
    batchStatus: 'SUCCESS',
    items: [...expected.entries()].map(([senderItemId, item]) => ({
      payoutItemId: `ITEM-${senderItemId.slice(0, 8)}`,
      transactionId: `TX-${senderItemId.slice(0, 8)}`,
      transactionStatus: 'SUCCESS',
      senderItemId,
      receiver: item.receiver,
    })),
  };
}

const invoices = {
  getInvoice: async () => {
    throw new Error('invoice path not used');
  },
  createDraftInvoice: async () => {
    throw new Error('invoice path not used');
  },
};
const neverPaypal = {
  getSubscription: async () => {
    throw new Error('PayPal must not be called');
  },
  getDispute: async () => {
    throw new Error('PayPal must not be called');
  },
};
const approvals = new ApprovalsService(
  prisma,
  config,
  audit,
  contacts,
  invoices,
  neverPaypal,
  neverPaypal,
  payouts,
  safety,
);

const created = { actions: [], contacts: [] };
// Gate 2 requires the tapper to be the workspace's linked chat: seed
// approvedBy from the owner link when one exists (else the env approver).
let approver = config.get('TELEGRAM_APPROVER_ID') ?? 'test-approver';
const stamp = Date.now();

async function makeAction({ type, name, email, amount, batchId }) {
  const contact = await prisma.contact.create({
    data: {
      workspaceId: 'owner',
      name,
      paypalEmail: email,
      kind: 'SUPPLIER',
      usualAmount: amount,
      currency: 'USD',
      payCount: 0,
    },
  });
  created.contacts.push(contact.id);
  const idempotencyKey = randomUUID();
  const action = await prisma.action.create({
    data: {
      workspaceId: 'owner',
      type,
      status: 'APPROVED',
      contactId: contact.id,
      payeeName: name,
      payeePaypal: email,
      amount,
      currency: 'USD',
      purpose: `payout mock ${stamp}`,
      extractedJson: { test: 'payout-mock' },
      riskFlags: [],
      policyVersion: 'test',
      policyVerdict: 'NEEDS_CONFIRMATION',
      confidence: 1,
      actionHash: computeActionHash({
        payeeName: name,
        payeePaypal: email,
        amount,
        currency: 'USD',
        purpose: `payout mock ${stamp}`,
        idempotencyKey,
      }),
      idempotencyKey,
      version: 1,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      approvedBy: approver,
      approvedAt: new Date(),
      batchId: batchId ?? null,
    },
  });
  created.actions.push(action.id);
  await prisma.auditLog.create({
    data: {
      actionId: action.id,
      event: 'APPROVED',
      detail: { version: 1, via: 'payout-mock' },
    },
  });
  return { action, contact };
}

async function cleanup() {
  for (const id of created.actions) {
    await prisma.auditLog.deleteMany({ where: { actionId: id } });
    await prisma.action.deleteMany({ where: { id } });
  }
  for (const id of created.contacts) {
    await prisma.contact.deleteMany({ where: { id } });
  }
}

(async () => {
  try {
    const ownerLink = await prisma.telegramLink.findFirst({
      where: { workspaceId: 'owner' },
      select: { telegramId: true },
    });
    if (ownerLink?.telegramId) approver = ownerLink.telegramId;
    const single = await makeAction({
      type: 'PAYOUT_SINGLE',
      name: `Mock Single ${stamp}`,
      email: `single-${stamp}@example.test`,
      amount: '5.00',
    });
    const singleResult = await approvals.executeApprovedAction(
      single.action.id,
    );
    const singleAfter = await prisma.action.findUnique({
      where: { id: single.action.id },
    });
    const singleContact = await prisma.contact.findUnique({
      where: { id: single.contact.id },
    });
    assert.equal(singleResult.ok, true);
    assert.equal(singleAfter.status, 'EXECUTED');
    assert.equal(singleContact.payCount, 1);
    const repeat = await approvals.executeApprovedAction(single.action.id);
    assert.equal(repeat.ok, true);
    assert.equal(repeat.paypalRef, singleResult.paypalRef);
    console.log('[PASS] single payout settles EXECUTED + learns contact');

    const batchId = randomUUID();
    const a = await makeAction({
      type: 'PAYOUT_BATCH',
      name: `Mock Batch A ${stamp}`,
      email: `batch-a-${stamp}@example.test`,
      amount: '3.00',
      batchId,
    });
    const b = await makeAction({
      type: 'PAYOUT_BATCH',
      name: `Mock Batch B ${stamp}`,
      email: `batch-b-${stamp}@example.test`,
      amount: '4.00',
      batchId,
    });
    const batchResult = await approvals.executeBatch(batchId);
    const members = await prisma.action.findMany({
      where: { batchId },
    });
    const contactA = await prisma.contact.findUnique({
      where: { id: a.contact.id },
    });
    const contactB = await prisma.contact.findUnique({
      where: { id: b.contact.id },
    });
    assert.equal(batchResult.ok, true);
    assert.equal(members.every((m) => m.status === 'EXECUTED'), true);
    assert.equal(contactA.payCount, 1);
    assert.equal(contactB.payCount, 1);
    console.log('[PASS] batch payout settles all members + learns contacts');

    const failed = await makeAction({
      type: 'PAYOUT_SINGLE',
      name: `Mock Failed ${stamp}`,
      email: `failed-${stamp}@example.test`,
      amount: '2.00',
    });
    await prisma.action.update({
      where: { id: failed.action.id },
      data: { status: 'FAILED' },
    });
    const retry = await approvals.executeApprovedAction(failed.action.id);
    assert.equal(retry.reason, 'not_retryable');
    console.log('[PASS] FAILED payout is not blindly retried');

    const stale = await makeAction({
      type: 'PAYOUT_SINGLE',
      name: `Mock Stale ${stamp}`,
      email: `stale-${stamp}@example.test`,
      amount: '2.00',
    });
    await prisma.action.update({
      where: { id: stale.action.id },
      data: {
        status: 'EXECUTING',
        updatedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    const reconciled = await approvals.reconcileStaleExecuting(5);
    const staleAfter = await prisma.action.findUnique({
      where: { id: stale.action.id },
    });
    assert.equal(staleAfter.status, 'FAILED');
    assert.equal(reconciled.requeued, 0);
    const unknownAudits = await prisma.auditLog.count({
      where: { actionId: stale.action.id, event: 'PAYOUT_UNKNOWN' },
    });
    assert.equal(unknownAudits, 1);
    console.log('[PASS] stale no-ref payout fails closed, no requeue/retry');
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});
