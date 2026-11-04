import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPredraftAsk, predraftCallback } from './predraft';

test('predraftCallback builds namespaced callback data', () => {
  assert.equal(predraftCallback('draft-yes', 'em1'), 'draft-yes:em1');
  assert.equal(predraftCallback('draft-no', 'em1'), 'draft-no:em1');
});

test('buildPredraftAsk renders an invoice ask with facts + buttons', () => {
  const ask = buildPredraftAsk({
    emailId: 'em1',
    kind: 'INVOICE_REQUEST',
    from: 'ada@example.com',
    subject: 'Invoice for flyers',
    payeeName: 'Ada Obi',
    payeeEmail: 'ada@example.com',
    amount: '450.00',
    currency: 'USD',
    purpose: 'flyers',
    confidence: 0.92,
  });
  assert.equal(
    ask.text,
    [
      '📨 <b>Money request by email</b>',
      'From: ada@example.com — “Invoice for flyers”',
      '',
      '🧾 Invoice: send USD 450.00 to Ada Obi (ada@example.com) for flyers',
      '<i>Understood with 92% confidence. Nothing is drafted yet.</i>',
      '',
      'Should I draft this? The draft will still come back as an approval card.',
    ].join('\n'),
  );
  assert.deepStrictEqual(ask.keyboard, {
    inline_keyboard: [
      [{ text: '✅ Yes, draft it', callback_data: 'draft-yes:em1' }],
      [{ text: '🚫 Ignore', callback_data: 'draft-no:em1' }],
    ],
  });
});

test('buildPredraftAsk renders a payout ask without a stated email', () => {
  const ask = buildPredraftAsk({
    emailId: 'em2',
    kind: 'PAYMENT_REQUEST',
    from: 'sam@example.com',
    subject: null,
    payeeName: 'Sam Reed',
    payeeEmail: null,
    amount: '50.00',
    currency: 'USD',
    purpose: 'refund',
    confidence: 0.81,
  });
  assert.ok(ask.text.includes('💸 Payment: pay USD 50.00 to Sam Reed for refund'));
  assert.ok(ask.text.includes('(no subject)'));
  assert.ok(ask.text.includes('81%'));
});

test('buildPredraftAsk escapes untrusted email text', () => {
  const ask = buildPredraftAsk({
    emailId: 'em3',
    kind: 'INVOICE_REQUEST',
    from: 'a<b>@x.com',
    subject: 'Pay <now>',
    payeeName: 'Eve',
    payeeEmail: 'eve@x.com',
    amount: '10.00',
    currency: 'USD',
    purpose: 'x & y',
    confidence: 0.5,
  });
  assert.ok(!ask.text.includes('<b>@x.com'));
  assert.ok(ask.text.includes('From: a&lt;b&gt;@x.com — “Pay &lt;now&gt;”'));
  assert.ok(ask.text.includes('for x &amp; y'));
});
