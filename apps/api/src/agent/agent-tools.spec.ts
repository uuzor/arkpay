import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MEMORY_KEY_HINTS,
  buildMemoryCapturePrompt,
  buildScheduleCreate,
  collectNonActionResults,
  daysOverdue,
  describeActionResult,
  describeNonActionResults,
  hasActionActivity,
  hasToolActivity,
  memoryBlockForPrompt,
  mergeInvoiceFollowUp,
  missingFieldsQuestion,
  normalizeMemoryKey,
  normalizeMemoryValue,
  parseDraftFollowUp,
  parseInvoiceFirstTurn,
  parseMemoryCapture,
  selectHistoryBudget,
  summarizeDunning,
  summarizeEmptyResult,
  summarizeScamCheck,
  verdictClient,
} from './agent-replies';

test('parseDraftFollowUp extracts name + purpose from a follow-up fragment', () => {
  assert.deepStrictEqual(
    parseDraftFollowUp('Its for my shoe, name is precious Ezealor'),
    { payeeName: 'precious Ezealor', purpose: 'my shoe' },
  );
});

test('parseDraftFollowUp handles name-only and purpose-only fragments', () => {
  assert.deepStrictEqual(parseDraftFollowUp('name is Ada Lovelace'), {
    payeeName: 'Ada Lovelace',
  });
  assert.deepStrictEqual(parseDraftFollowUp("It's for flyers"), {
    purpose: 'flyers',
  });
});

test('parseDraftFollowUp ignores emails, amounts, new intents and noise', () => {
  assert.equal(parseDraftFollowUp('ada@example.com'), null);
  assert.equal(parseDraftFollowUp('make it $300'), null);
  assert.equal(parseDraftFollowUp('Pay Ada $50 for flyers'), null);
  assert.equal(parseDraftFollowUp('what is my balance?'), null);
  assert.equal(parseDraftFollowUp('remind me on Friday'), null);
  assert.equal(parseDraftFollowUp(''), null);
  assert.equal(parseDraftFollowUp('x'.repeat(201)), null);
});

test('describeActionResult narrates a created invoice draft', () => {
  assert.equal(
    describeActionResult('create_invoice_draft', {
      ok: true,
      payeeName: 'Ada',
      amount: '450.00',
      currency: 'USD',
      purpose: 'flyers',
    }),
    '🧾 Draft created for Ada: USD 450.00 for flyers. Approve the card to send it.',
  );
});

test('describeActionResult narrates a drafted payout', () => {
  assert.equal(
    describeActionResult('request_payout', {
      ok: true,
      payeeName: 'Ada',
      amount: '450.00',
      currency: 'USD',
      purpose: 'flyers',
    }),
    '💸 Payout drafted for Ada: USD 450.00 for flyers. Nothing moves until you tap Pay.',
  );
});

test('describeActionResult falls back to the tool message', () => {
  assert.equal(
    describeActionResult('create_invoice_draft', {
      ok: false,
      message: 'Ask for the missing fields.',
    }),
    'Ask for the missing fields.',
  );
  assert.equal(
    describeActionResult('follow_up_invoice', {
      ok: true,
      message: 'Reminder sent.',
    }),
    'Reminder sent.',
  );
  assert.equal(
    describeActionResult('create_schedule', {
      ok: true,
      message: 'Scheduled "x"; next run 2026-01-01.',
    }),
    'Scheduled "x"; next run 2026-01-01.',
  );
});

test('describeActionResult returns null when there is nothing to narrate', () => {
  assert.equal(
    describeActionResult('follow_up_invoice', { ok: true }),
    null,
  );
  assert.equal(describeActionResult('list_schedules', { ok: true }), null);
  assert.equal(describeActionResult('create_invoice_draft', null), null);
  assert.equal(describeActionResult('create_invoice_draft', 'oops'), null);
});

test('buildScheduleCreate accepts a valid NOTIFY schedule', () => {
  const r = buildScheduleCreate({
    title: 'Friday chase',
    kind: 'notify',
    detail: 'Chase unpaid invoices',
    trigger: 'cron',
    cron: '0 9 * * FRI',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.input.kind, 'NOTIFY');
    assert.equal(r.input.timezone, 'UTC');
  }
});

test('buildScheduleCreate rejects missing title, kind and trigger', () => {
  assert.equal(buildScheduleCreate({}).ok, false);
  assert.equal(
    buildScheduleCreate({
      title: 'x',
      kind: 'NOPE',
      trigger: 'ONCE',
      runAt: new Date().toISOString(),
    }).ok,
    false,
  );
  assert.equal(
    buildScheduleCreate({
      title: 'x',
      kind: 'NOTIFY',
      detail: 'm',
      trigger: 'WEEKLY',
    }).ok,
    false,
  );
});

test('buildScheduleCreate requires detail for NOTIFY/AGENT_TASK only', () => {
  assert.equal(
    buildScheduleCreate({
      title: 'x',
      kind: 'NOTIFY',
      trigger: 'ONCE',
      runAt: new Date().toISOString(),
    }).ok,
    false,
  );
  const b = buildScheduleCreate({
    title: 'Sweep',
    kind: 'INVOICE_REMINDERS',
    trigger: 'INTERVAL',
    intervalMinutes: 360,
  });
  assert.equal(b.ok, true);
  if (b.ok) assert.equal(b.input.detail, 'Sweep');
});

test('buildScheduleCreate enforces per-trigger fields', () => {
  assert.equal(
    buildScheduleCreate({ title: 'x', kind: 'NOTIFY', detail: 'm', trigger: 'ONCE' })
      .ok,
    false,
  );
  assert.equal(
    buildScheduleCreate({
      title: 'x',
      kind: 'NOTIFY',
      detail: 'm',
      trigger: 'INTERVAL',
      intervalMinutes: 0,
    }).ok,
    false,
  );
  assert.equal(
    buildScheduleCreate({ title: 'x', kind: 'NOTIFY', detail: 'm', trigger: 'CRON' })
      .ok,
    false,
  );
});

test('parseInvoiceFirstTurn extracts email + trailing-$ amount (probe turn 1)', () => {
  assert.deepStrictEqual(
    parseInvoiceFirstTurn(
      'Create an invoice and send to precious.e.ezealor@gmail.com of 200$',
    ),
    {
      payeeEmail: 'precious.e.ezealor@gmail.com',
      amount: '200',
      currency: 'USD',
    },
  );
});

test('parseInvoiceFirstTurn takes purpose after the last "for"', () => {
  assert.deepStrictEqual(
    parseInvoiceFirstTurn(
      'Send invoice to Ada (ada@example.com) for $450 for flyers',
    ),
    {
      payeeEmail: 'ada@example.com',
      amount: '450',
      currency: 'USD',
      purpose: 'flyers',
    },
  );
  // No payee anchor, so no purpose guess — the follow-up asks safely.
  assert.deepStrictEqual(
    parseInvoiceFirstTurn('Invoice Bob $100 for design work'),
    { amount: '100', currency: 'USD' },
  );
  assert.deepStrictEqual(parseInvoiceFirstTurn('Bill Ada $450 for flyers'), {
    amount: '450',
    currency: 'USD',
  });
});

test('parseInvoiceFirstTurn rejects reads, revisits, undos and moneyless asks', () => {
  assert.equal(parseInvoiceFirstTurn('Show my invoices'), null);
  assert.equal(parseInvoiceFirstTurn('Follow up on INV2-001'), null);
  assert.equal(parseInvoiceFirstTurn('Why was invoice INV2-001 blocked?'), null);
  assert.equal(
    parseInvoiceFirstTurn('Resend invoice INV2-001 to ada@example.com'),
    null,
  );
  assert.equal(parseInvoiceFirstTurn('Cancel invoice INV2-001'), null);
  assert.equal(parseInvoiceFirstTurn('Pay Ada $50 for flyers'), null);
  assert.equal(parseInvoiceFirstTurn('Invoice INV2-001 status'), null);
  assert.equal(parseInvoiceFirstTurn('Make me an invoice template'), null);
  assert.equal(parseInvoiceFirstTurn('How do I create an invoice?'), null);
  assert.equal(parseInvoiceFirstTurn('Show me an invoice example'), null);
  assert.equal(parseInvoiceFirstTurn(''), null);
  assert.equal(parseInvoiceFirstTurn('x'.repeat(301)), null);
});

test('parseInvoiceFirstTurn returns {} for moneyless intents (kickoff)', () => {
  assert.deepStrictEqual(parseInvoiceFirstTurn('Create an invoice'), {});
  assert.deepStrictEqual(parseInvoiceFirstTurn('Send an invoice'), {});
  assert.deepStrictEqual(
    parseInvoiceFirstTurn('Can you create an invoice for me?'),
    {},
  );
});

test('mergeInvoiceFollowUp completes fully-specified replies', () => {
  assert.deepStrictEqual(
    mergeInvoiceFollowUp(
      { payeeEmail: 'p@x.co', amount: '200', currency: 'USD' },
      'Its for my shoe, name is precious Ezealor',
    ),
    {
      fields: {
        payeeName: 'precious Ezealor',
        payeeEmail: 'p@x.co',
        amount: '200',
        currency: 'USD',
        purpose: 'my shoe',
      },
      complete: true,
    },
  );
  assert.deepStrictEqual(
    mergeInvoiceFollowUp({}, 'bill ada@example.com $450 for flyers, name is Ada Obi'),
    {
      fields: {
        payeeName: 'Ada Obi',
        payeeEmail: 'ada@example.com',
        amount: '450',
        currency: 'USD',
        purpose: 'flyers',
      },
      complete: true,
    },
  );
});

test('mergeInvoiceFollowUp merges partials and rejects noise', () => {
  const merged = mergeInvoiceFollowUp(
    { payeeName: 'Ada', amount: '450', purpose: 'flyers' },
    'ada@example.com',
  );
  assert.equal(merged?.complete, true);
  assert.equal(merged?.fields.payeeEmail, 'ada@example.com');
  assert.equal(
    mergeInvoiceFollowUp({ amount: '450' }, 'Create an invoice for Bob'),
    null,
  );
  assert.equal(mergeInvoiceFollowUp({}, 'cancel that'), null);
  assert.equal(mergeInvoiceFollowUp({}, 'ok thanks!'), null);
});

test('missingFieldsQuestion asks for name + purpose with facts and a hint', () => {
  assert.equal(
    missingFieldsQuestion(['payeeName', 'purpose'], {
      payeeEmail: 'precious.e.ezealor@gmail.com',
      amount: '200',
      currency: 'USD',
    }),
    '🧾 Invoice draft started — USD 200, to precious.e.ezealor@gmail.com. ' +
      'What\'s the payee\'s name and what it\'s for? ' +
      'Reply like: "for flyers, name is Ada Obi".',
  );
  assert.equal(
    missingFieldsQuestion(['payeeEmail'], {
      payeeName: 'Ada',
      amount: '450',
      currency: 'USD',
      purpose: 'flyers',
    }),
    '🧾 Invoice draft started — USD 450, payee Ada, for flyers. ' +
      "What's the PayPal email?",
  );
});

test('missingFieldsQuestion asks the kickoff when nothing is known', () => {
  assert.equal(
    missingFieldsQuestion(['payeeName', 'amount', 'purpose', 'payeeEmail'], {}),
    '🧾 Sure — who should I bill, for how much, and what\'s it for? ' +
      'Include the PayPal email to bill. Reply like: "bill ada@example.com $450 for flyers".',
  );
});

test('hasToolActivity sees step calls and top-level buckets', () => {
  assert.equal(
    hasToolActivity({ steps: [{ toolCalls: [{ toolName: 'x' }] }] }),
    true,
  );
  assert.equal(hasToolActivity({ steps: [], toolCalls: [{ a: 1 }] }), true);
  assert.equal(hasToolActivity({ dynamicToolCalls: [1] }), true);
  assert.equal(
    hasToolActivity({
      text: '',
      steps: [{ text: '', toolCalls: [], toolResults: [] }],
      finishReason: 'stop',
    }),
    false,
  );
  assert.equal(hasToolActivity(null), false);
  assert.equal(hasToolActivity({}), false);
  assert.equal(hasToolActivity({ steps: [] }), false);
});

test('summarizeEmptyResult renders a one-line shape summary', () => {
  assert.equal(
    summarizeEmptyResult({
      finishReason: 'stop',
      steps: [
        { text: '', toolCalls: [], toolResults: [], finishReason: 'stop' },
      ],
      warnings: [],
      usage: { inputTokens: 10 },
    }),
    'finish=stop steps=1[#0 text=0 calls=0 results=0 finish=stop] ' +
      'warnings=0 usage={"inputTokens":10}',
  );
  assert.equal(summarizeEmptyResult(null), 'no result');
});

test('normalizeMemoryKey accepts snake_case, trims and coerces spaces', () => {
  assert.equal(normalizeMemoryKey('display_name'), 'display_name');
  assert.equal(normalizeMemoryKey('  Display Name '), 'display_name');
  assert.equal(normalizeMemoryKey('my-key'), 'my_key');
  assert.equal(normalizeMemoryKey('UPPER-AT'), 'upper_at');
  for (const bad of ['', 'has space!', '9lives', 'a'.repeat(33), 42, null]) {
    assert.equal(normalizeMemoryKey(bad), null);
  }
});

test('normalizeMemoryValue trims, collapses whitespace and caps length', () => {
  assert.equal(normalizeMemoryValue('  Ada   Lovelace  '), 'Ada Lovelace');
  assert.equal(normalizeMemoryValue(''), null);
  assert.equal(normalizeMemoryValue('   '), null);
  const long = normalizeMemoryValue('x'.repeat(600));
  assert.equal(long?.length, 500);
});

test('memoryBlockForPrompt renders saved facts, empty when none', () => {
  assert.equal(memoryBlockForPrompt([]), '');
  assert.equal(memoryBlockForPrompt(null), '');
  const block = memoryBlockForPrompt([
    { key: 'display_name', value: 'Victor' },
    { key: 'default_currency', value: 'USD' },
  ]);
  assert.match(block, /display_name: Victor/);
  assert.match(block, /default_currency: USD/);
  assert.match(block, /don't re-ask/);
  // Invalid rows never reach the model.
  assert.equal(
    memoryBlockForPrompt([{ key: '!!!', value: 'x' }]),
    '',
  );
});

test('MEMORY_KEY_HINTS covers the facts the prompt asks the model to save', () => {
  for (const hint of ['display_name', 'default_currency', 'timezone']) {
    assert.ok((MEMORY_KEY_HINTS as readonly string[]).includes(hint));
  }
});

test('selectHistoryBudget keeps the newest turns inside a char budget', () => {
  const mk = (n: number, len: number) => ({
    role: 'user',
    content: `${n}:` + 'x'.repeat(len),
  });
  const msgs = [mk(1, 100), mk(2, 100), mk(3, 100)];
  assert.deepStrictEqual(selectHistoryBudget(msgs, 250).map((m) => m.content.slice(0, 2)), ['2:', '3:']);
  // Newest turn is always kept even when it alone exceeds the budget.
  const huge = selectHistoryBudget([mk(1, 50), mk(2, 10_000)], 100);
  assert.equal(huge.length, 1);
  assert.match(huge[0].content, /^2:/);
  // Everything fits: order preserved.
  assert.deepStrictEqual(selectHistoryBudget(msgs, 10_000).length, 3);
});

test('hasActionActivity blocks retry only after state-changing tools', () => {
  const actions = ['create_invoice_draft', 'request_payout'];
  assert.equal(hasActionActivity({ steps: [] }, actions), false);
  assert.equal(
    hasActionActivity(
      { steps: [{ toolCalls: [{ toolName: 'get_paypal_balance' }] }] },
      actions,
    ),
    false,
  );
  assert.equal(
    hasActionActivity(
      { steps: [{ toolCalls: [{ toolName: 'request_payout' }] }] },
      actions,
    ),
    true,
  );
  assert.equal(
    hasActionActivity(
      { steps: [{ toolResults: [{ toolName: 'create_invoice_draft', output: {} }] }] },
      actions,
    ),
    true,
  );
});

test('collectNonActionResults skips action tools and caps items', () => {
  const actions = ['request_payout'];
  const result = {
    steps: [
      {
        toolResults: [
          { toolName: 'request_payout', output: { ok: true } },
          { toolName: 'get_paypal_balance', output: { available: true } },
          { toolName: 'search_emails', output: { count: 2 } },
        ],
      },
    ],
  };
  const got = collectNonActionResults(result, actions, 1);
  assert.equal(got.length, 1);
  assert.equal(got[0].toolName, 'get_paypal_balance');
  assert.deepStrictEqual(collectNonActionResults({ steps: [] }, actions), []);
});

test('describeNonActionResults shows facts instead of the canned greeting', () => {
  assert.equal(describeNonActionResults([]), null);
  assert.equal(describeNonActionResults(null), null);
  const text = describeNonActionResults([
    { toolName: 'get_paypal_balance', output: { available: true, currency: 'USD' } },
  ]);
  assert.match(text ?? '', /PayPal balance/);
  assert.match(text ?? '', /couldn't phrase the answer/);
  assert.ok(!(text ?? '').includes("I'm here"));
});

test('describeActionResult reuses subscription/dispute tool messages verbatim', () => {
  assert.equal(
    describeActionResult('manage_subscription', {
      ok: true,
      message: 'Cancellation drafted and approval card sent.',
    }),
    'Cancellation drafted and approval card sent.',
  );
  assert.equal(
    describeActionResult('respond_dispute', {
      ok: true,
      message: 'Reply drafted and approval card sent with the exact text.',
    }),
    'Reply drafted and approval card sent with the exact text.',
  );
  assert.equal(
    describeActionResult('manage_subscription', {
      ok: false,
      message: 'Cannot cancel subscription I-1: it is CANCELLED.',
    }),
    'Cannot cancel subscription I-1: it is CANCELLED.',
  );
  assert.equal(describeActionResult('manage_subscription', null), null);
});

test('describeNonActionResults names subscription/dispute reads', () => {
  const text = describeNonActionResults([
    { toolName: 'list_subscriptions', output: { count: 3 } },
    { toolName: 'subscription_report', output: { total: 3 } },
    { toolName: 'list_disputes', output: { count: 1 } },
    { toolName: 'get_dispute', output: { id: 'PP-1' } },
  ]);
  assert.match(text ?? '', /Subscriptions/);
  assert.match(text ?? '', /Subscription report/);
  assert.match(text ?? '', /Disputes/);
  assert.match(text ?? '', /Dispute details/);
});

test('describeNonActionResults names the earner brief tools', () => {
  const text = describeNonActionResults([
    { toolName: 'verify_client', output: { verdict: 'new' } },
    { toolName: 'scam_check', output: { summary: 'ok' } },
    { toolName: 'dunning_brief', output: { overdue: [] } },
  ]);
  assert.match(text ?? '', /Client check/);
  assert.match(text ?? '', /Scam check/);
  assert.match(text ?? '', /Overdue list/);
});

test('buildMemoryCapturePrompt carries the turn and known memories', () => {
  const prompt = buildMemoryCapturePrompt('I bill in USD', 'Noted!', [
    { key: 'user_name', value: 'Ada' },
  ]);
  assert.match(prompt, /I bill in USD/);
  assert.match(prompt, /user_name: Ada/);
  assert.match(prompt, /JSON array only/);
});

test('parseMemoryCapture keeps valid entries, caps at 3, never throws', () => {
  assert.deepStrictEqual(parseMemoryCapture('[{"key": "a", "value": "b"}]'), [
    { key: 'a', value: 'b' },
  ]);
  assert.deepStrictEqual(
    parseMemoryCapture('Sure! [{"key": "a", "value": "b"}, {"k": 1}, {"key": "", "value": "x"}] done'),
    [{ key: 'a', value: 'b' }],
  );
  assert.deepStrictEqual(
    parseMemoryCapture('[{"key":"1","value":"v"},{"key":"2","value":"v"},{"key":"3","value":"v"},{"key":"4","value":"v"}]').length,
    3,
  );
  assert.deepStrictEqual(parseMemoryCapture('no json here'), []);
  assert.deepStrictEqual(parseMemoryCapture('[{"key": unclosed'), []);
  assert.deepStrictEqual(parseMemoryCapture(null), []);
});

test('verdictClient: new, known-good, caution', () => {
  assert.equal(verdictClient({ found: false }).verdict, 'new');
  const good = verdictClient({ found: true, payCount: 4 });
  assert.equal(good.verdict, 'known-good');
  assert.match(good.notes.join(' '), /4 payment/);
  const caution = verdictClient({
    found: true,
    payCount: 2,
    blockedCount: 1,
    openDisputeCount: 1,
    changedFlags: true,
  });
  assert.equal(caution.verdict, 'caution');
  assert.equal(caution.notes.length, 4);
});

test('summarizeScamCheck is silent when clean, specific when not', () => {
  assert.equal(
    summarizeScamCheck({ flaggedActions: 0, atRiskSubs: 0, openDisputes: 0, newPayees: 0 }),
    'Nothing suspicious in the latest activity.',
  );
  const text = summarizeScamCheck({ flaggedActions: 2, atRiskSubs: 0, openDisputes: 1, newPayees: 0 });
  assert.match(text, /2 flagged action/);
  assert.match(text, /1 open dispute/);
});

test('daysOverdue counts whole days past due, 0 otherwise', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assert.equal(daysOverdue('2026-11-01T00:00:00Z', now), 9);
  assert.equal(daysOverdue('2026-11-10T11:00:00Z', now), 0);
  assert.equal(daysOverdue('2026-11-12T00:00:00Z', now), 0);
  assert.equal(daysOverdue('not-a-date', now), 0);
});

test('summarizeDunning totals the chase list', () => {
  assert.equal(summarizeDunning([], 0), 'Nobody owes you money right now.');
  const text = summarizeDunning(
    [
      { payeeName: 'Ada', amount: 450, currency: 'USD', daysOverdue: 14, reminders: 1 },
      { payeeName: 'Bob', amount: 50, currency: 'USD', daysOverdue: 3, reminders: 0 },
    ],
    1,
  );
  assert.match(text, /2 overdue invoice\(s\) ≈ USD 500\.00/);
  assert.match(text, /Ada.*14d overdue/);
  assert.match(text, /1 subscription\(s\) past due/);
});
