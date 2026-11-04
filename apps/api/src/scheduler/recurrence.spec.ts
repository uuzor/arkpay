import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceAfterRun, nextRunAfter } from './recurrence';

test('ONCE returns the run time only when it is in the future', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  assert.equal(
    nextRunAfter({ trigger: 'ONCE', runAt: '2026-11-10T09:00:00Z' }, now)?.toISOString(),
    '2026-11-10T09:00:00.000Z',
  );
  assert.equal(
    nextRunAfter({ trigger: 'ONCE', runAt: '2026-11-01T09:00:00Z' }, now),
    null,
  );
});

test('INTERVAL advances and skips past occurrences', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  assert.equal(
    nextRunAfter({ trigger: 'INTERVAL', intervalMinutes: 60 }, now)?.toISOString(),
    '2026-11-03T01:00:00.000Z',
  );
});

test('CRON monthly respects the timezone', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  assert.equal(
    nextRunAfter(
      { trigger: 'CRON', cron: '0 9 1 * *', timezone: 'UTC' },
      now,
    )?.toISOString(),
    '2026-12-01T09:00:00.000Z',
  );
  assert.equal(
    nextRunAfter(
      { trigger: 'CRON', cron: '0 9 1 * *', timezone: 'Africa/Lagos' },
      now,
    )?.toISOString(),
    '2026-12-01T08:00:00.000Z',
  );
});

test('advanceAfterRun jumps over a missed backlog', () => {
  const schedule = {
    trigger: 'CRON',
    cron: '0 9 1 * *',
    timezone: 'UTC',
  };
  const now = new Date('2027-03-15T12:00:00Z');
  const next = advanceAfterRun(
    schedule,
    new Date('2026-11-01T09:00:00Z'),
    now,
  );
  assert.equal(next?.toISOString(), '2027-04-01T09:00:00.000Z');
});

test('invalid intervals and cron expressions throw', () => {
  assert.throws(() => nextRunAfter({ trigger: 'INTERVAL' }, new Date()));
  assert.throws(() => nextRunAfter({ trigger: 'CRON' }, new Date()));
  assert.throws(() =>
    nextRunAfter(
      { trigger: 'CRON', cron: 'not a cron', timezone: 'UTC' },
      new Date(),
    ),
  );
});
