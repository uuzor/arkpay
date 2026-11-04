import { Prisma, ScheduleStatus } from '@prisma/client';

export interface SystemSeedInput {
  payrollCron: string;
  payrollTimezone: string;
  payrollEnabled: boolean;
  followupCron: string;
  followupEnabled: boolean;
}

export interface SystemSeedDefinition {
  systemKey: string;
  title: string;
  detail: string;
  kind: string;
  status: ScheduleStatus;
  trigger: 'CRON';
  cron: string;
  timezone: string;
  misfireGraceMinutes: number;
  payload: Prisma.InputJsonValue;
}

/**
 * The two seeded schedules, as pure data. Shared by the legacy global
 * ensureDefaults and per-workspace signup seeding (AuthModule imports this
 * file, not the scheduler module — SchedulerModule depends on TelegramModule,
 * so a module-level import would cycle).
 */
export function systemSeedDefinitions(
  input: SystemSeedInput,
): SystemSeedDefinition[] {
  return [
    {
      systemKey: 'payroll.monthly',
      title: 'Monthly payroll prep',
      detail:
        'Prepare the STAFF payroll batch for the current month and send one approval card.',
      kind: 'PAYROLL_PREPARE',
      status: input.payrollEnabled
        ? ScheduleStatus.ACTIVE
        : ScheduleStatus.PAUSED,
      trigger: 'CRON',
      cron: input.payrollCron,
      timezone: input.payrollTimezone,
      misfireGraceMinutes: 4320,
      payload: { periodOffsetMonths: 0 },
    },
    {
      systemKey: 'reminders.invoice-followup',
      title: 'Invoice follow-up scan',
      detail:
        'Check executed invoices and send the next due PayPal reminder stage.',
      kind: 'INVOICE_REMINDERS',
      status: input.followupEnabled
        ? ScheduleStatus.ACTIVE
        : ScheduleStatus.PAUSED,
      trigger: 'CRON',
      cron: input.followupCron,
      timezone: 'UTC',
      misfireGraceMinutes: 60,
      payload: {},
    },
  ];
}
