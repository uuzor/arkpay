import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessDispute,
  assessSubscription,
  humanDisputeReason,
  summarizePortfolio,
} from './billing-analysis';

const NOW = new Date('2026-11-07T12:00:00Z');

test('assessSubscription flags failing payments + past due', () => {
  const a = assessSubscription(
    {
      id: 'I-1',
      status: 'ACTIVE',
      subscriberName: 'Ada',
      lastPaymentAmount: '20.00',
      lastPaymentCurrency: 'USD',
      lastPaymentTime: '2026-11-01T00:00:00Z',
      failedPaymentsCount: 2,
      outstandingBalance: '40.00',
      outstandingCurrency: 'USD',
    },
    NOW,
  );
  assert.deepEqual(a.flags, ['FAILED_PAYMENTS', 'PAST_DUE']);
  assert.equal(a.daysSincePayment, 6);
  assert.match(a.summary, /Ada/);
});

test('assessSubscription flags suspended and stale-active', () => {
  const suspended = assessSubscription(
    { id: 'I-2', status: 'SUSPENDED' },
    NOW,
  );
  assert.deepEqual(suspended.flags, ['SUSPENDED']);

  const stale = assessSubscription(
    {
      id: 'I-3',
      status: 'ACTIVE',
      lastPaymentTime: '2026-08-01T00:00:00Z',
    },
    NOW,
  );
  assert.deepEqual(stale.flags, ['STALE_ACTIVE']);
  assert.ok((stale.daysSincePayment ?? 0) > 45);
});

test('assessSubscription: healthy sub has no flags', () => {
  const a = assessSubscription(
    {
      id: 'I-4',
      status: 'ACTIVE',
      subscriberEmail: 'bob@test.example',
      lastPaymentAmount: '10.00',
      lastPaymentCurrency: 'USD',
      lastPaymentTime: '2026-11-06T00:00:00Z',
      failedPaymentsCount: 0,
      outstandingBalance: '0.00',
      outstandingCurrency: 'USD',
    },
    NOW,
  );
  assert.deepEqual(a.flags, []);
  assert.match(a.summary, /healthy/);
});

test('summarizePortfolio rolls up counts, MRR, exposure, risk order', () => {
  const report = summarizePortfolio(
    [
      {
        id: 'I-healthy',
        status: 'ACTIVE',
        lastPaymentAmount: '20.00',
        lastPaymentCurrency: 'USD',
        lastPaymentTime: '2026-11-06T00:00:00Z',
      },
      {
        id: 'I-pastdue',
        status: 'ACTIVE',
        lastPaymentAmount: '15.00',
        lastPaymentCurrency: 'USD',
        lastPaymentTime: '2026-11-05T00:00:00Z',
        outstandingBalance: '15.00',
        outstandingCurrency: 'USD',
      },
      {
        id: 'I-failing',
        status: 'ACTIVE',
        lastPaymentAmount: '30.00',
        lastPaymentCurrency: 'USD',
        lastPaymentTime: '2026-10-01T00:00:00Z',
        failedPaymentsCount: 3,
      },
      { id: 'I-cancelled', status: 'CANCELLED' },
    ],
    NOW,
  );
  assert.equal(report.total, 4);
  assert.deepEqual(report.byStatus, { ACTIVE: 3, CANCELLED: 1 });
  assert.deepEqual(report.activeMrr, { USD: '65.00' });
  assert.deepEqual(report.pastDueTotal, { USD: '15.00' });
  assert.equal(report.healthy, 1);
  assert.deepEqual(
    report.atRisk.map((a) => a.id),
    ['I-failing', 'I-pastdue'],
  );
});

test('assessDispute: inquiry + message link suggests a reply', () => {
  const a = assessDispute({
    id: 'PP-1',
    lifeCycleStage: 'INQUIRY',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    links: ['self', 'send-message', 'make-offer'],
  });
  assert.deepEqual(a.allowed, ['send_message', 'make_offer']);
  assert.equal(a.suggestion, 'send_message');
});

test('assessDispute: claim stage waiting on seller suggests evidence', () => {
  const a = assessDispute({
    id: 'PP-2',
    lifeCycleStage: 'CHARGEBACK',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    links: ['self', 'provide-evidence', 'accept-claim'],
  });
  assert.equal(a.suggestion, 'provide_evidence');
});

test('assessDispute: under review waits, no links means none', () => {
  const review = assessDispute({
    id: 'PP-3',
    state: 'UNDER_PAYPAL_REVIEW',
    links: ['self'],
  });
  assert.equal(review.suggestion, 'wait_paypal');

  const stuck = assessDispute({ id: 'PP-4', links: ['self'] });
  assert.deepEqual(stuck.allowed, []);
  assert.equal(stuck.suggestion, 'none');
});

test('humanDisputeReason renders codes readably', () => {
  assert.equal(
    humanDisputeReason('MERCHANDISE_OR_SERVICE_NOT_RECEIVED'),
    'Merchandise Or Service Not Received',
  );
  assert.equal(humanDisputeReason(undefined), 'unspecified reason');
});
