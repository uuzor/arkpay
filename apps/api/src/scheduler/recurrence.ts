import { CronExpressionParser } from 'cron-parser';

export type ScheduleTrigger = 'ONCE' | 'INTERVAL' | 'CRON';

export interface RecurrenceFields {
  trigger: string;
  runAt?: Date | string | null;
  intervalMinutes?: number | null;
  cron?: string | null;
  timezone?: string | null;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The next occurrence strictly after `from`. Returns null for a completed
 * one-off schedule. Throws only when the schedule definition is invalid, so
 * the API can reject bad cron/interval values before they reach the runner.
 */
export function nextRunAfter(
  schedule: RecurrenceFields,
  from: Date,
): Date | null {
  const trigger = schedule.trigger?.toUpperCase() as ScheduleTrigger;
  if (trigger === 'ONCE') {
    const runAt = asDate(schedule.runAt);
    return runAt && runAt.getTime() > from.getTime() ? runAt : null;
  }
  if (trigger === 'INTERVAL') {
    const minutes = Number(schedule.intervalMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error('intervalMinutes must be a positive number');
    }
    return new Date(from.getTime() + minutes * 60_000);
  }
  if (trigger === 'CRON') {
    const expression = schedule.cron?.trim();
    if (!expression) throw new Error('cron expression is required');
    const interval = CronExpressionParser.parse(expression, {
      currentDate: from,
      tz: schedule.timezone?.trim() || 'UTC',
    });
    return interval.next().toDate();
  }
  throw new Error(`unsupported schedule trigger: ${schedule.trigger}`);
}

/**
 * After a run completes, advance from the occurrence that just ran. If the
 * result is still in the past (server was down for several occurrences), jump
 * to the next future occurrence instead of replaying the backlog.
 */
export function advanceAfterRun(
  schedule: RecurrenceFields,
  scheduledFor: Date,
  now = new Date(),
): Date | null {
  const next = nextRunAfter(schedule, scheduledFor);
  if (!next) return null;
  if (next.getTime() > now.getTime()) return next;
  return nextRunAfter(schedule, now);
}
