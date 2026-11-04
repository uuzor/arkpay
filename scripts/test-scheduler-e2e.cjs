#!/usr/bin/env node
/**
 * Phase 8b scheduler integration check.
 *
 * - seeds the system schedules
 * - one due NOOP schedule runs exactly once across two ticks
 * - a PAYROLL_PREPARE schedule prepares one PayrollRun + one batch and sends
 *   one card (Telegram transport stubbed)
 * - re-running payroll does not prepare a second batch
 *
 * Run after `pnpm --filter @arkpay/api build`:
 *   pnpm --filter @arkpay/api exec dotenv -e ../../.env -- \
 *     node ../../scripts/test-scheduler-e2e.cjs
 */
const assert = require('node:assert/strict');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../apps/api/dist/app.module');
const {
  SchedulerService,
} = require('../apps/api/dist/scheduler/scheduler.service');
const {
  ScheduleHandlers,
} = require('../apps/api/dist/scheduler/handlers.service');
const { PrismaService } = require('../apps/api/dist/prisma/prisma.service');
const {
  periodInTimezone,
} = require('../apps/api/dist/payouts/payroll-period');

const created = { schedules: [], payrollPeriods: [], contacts: [] };

async function cleanup(prisma) {
  for (const id of created.schedules) {
    await prisma.scheduleRun.deleteMany({ where: { scheduleId: id } });
    await prisma.schedule.deleteMany({ where: { id } });
  }
  for (const period of created.payrollPeriods) {
    const runs = await prisma.payrollRun.findMany({ where: { period } });
    for (const run of runs) {
      const actions = await prisma.action.findMany({
        where: { batchId: run.batchId },
      });
      for (const action of actions) {
        await prisma.auditLog.deleteMany({ where: { actionId: action.id } });
        await prisma.action.delete({ where: { id: action.id } });
      }
      await prisma.payrollRun.delete({ where: { id: run.id } });
    }
  }
  for (const id of created.contacts) {
    await prisma.contact.deleteMany({ where: { id } });
  }
}

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const prisma = app.get(PrismaService);
  const scheduler = app.get(SchedulerService);
  const handlers = app.get(ScheduleHandlers);

  try {
    await scheduler.ensureDefaults();
    const seeded = await prisma.schedule.findMany({
      where: { systemKey: { not: null } },
      select: { systemKey: true, nextRunAt: true },
    });
    assert.ok(
      seeded.some((row) => row.systemKey === 'payroll.monthly'),
      'monthly payroll schedule seeded',
    );
    assert.ok(
      seeded.some((row) => row.systemKey === 'reminders.invoice-followup'),
      'invoice follow-up schedule seeded',
    );
    console.log('[PASS] system schedules seeded');

    const noop = await scheduler.create(
      {
        title: 'Scheduler smoke',
        detail: 'Integration smoke test',
        kind: 'NOOP',
        trigger: 'INTERVAL',
        intervalMinutes: 1440,
        payload: {},
        misfireGraceMinutes: 60,
      },
      'owner',
    );
    created.schedules.push(noop.id);
    await prisma.schedule.update({
      where: { id: noop.id },
      data: { nextRunAt: new Date(Date.now() - 60_000) },
    });
    await scheduler.tick();
    await scheduler.tick();
    const noopRuns = await prisma.scheduleRun.findMany({
      where: { scheduleId: noop.id },
    });
    assert.equal(noopRuns.length, 1, 'one run for one occurrence');
    assert.equal(noopRuns[0].status, 'SUCCEEDED');
    console.log('[PASS] two ticks produced exactly one run');

    const period = periodInTimezone(new Date(), 'UTC');
    created.payrollPeriods.push(period);
    const contact = await prisma.contact.create({
      data: {
        workspaceId: 'owner',
        name: `Scheduler Payroll ${Date.now()}`,
        kind: 'STAFF',
        paypalEmail: `scheduler-${Date.now()}@example.test`,
        usualAmount: '12.00',
        currency: 'USD',
        payCount: 1,
      },
    });
    created.contacts.push(contact.id);

    let cards = 0;
    handlers.telegram.sendBatchCard = async () => {
      cards += 1;
      return 9001;
    };
    const payrollSchedule = await scheduler.create(
      {
        title: 'Payroll integration',
        detail: 'Integration payroll run',
        kind: 'PAYROLL_PREPARE',
        trigger: 'INTERVAL',
        intervalMinutes: 1440,
        payload: { periodOffsetMonths: 0 },
        misfireGraceMinutes: 60,
      },
      'owner',
    );
    created.schedules.push(payrollSchedule.id);

    const first = await scheduler.runNow(payrollSchedule.id);
    const runsAfterFirst = await prisma.payrollRun.findMany({
      where: { period },
    });
    assert.equal(first.status, 'SUCCEEDED');
    assert.equal(runsAfterFirst.length, 1);
    assert.equal(cards, 1, 'one batch card sent');
    const actions = await prisma.action.findMany({
      where: { batchId: runsAfterFirst[0].batchId },
    });
    assert.equal(actions.length, 1, 'one payroll action');

    const second = await scheduler.runNow(payrollSchedule.id);
    const runsAfterSecond = await prisma.payrollRun.findMany({
      where: { period },
    });
    assert.equal(second.status, 'SUCCEEDED');
    assert.equal(runsAfterSecond.length, 1, 'second run reuses the payroll');
    assert.equal(cards, 1, 'second run does not resend a card');
    const result = second.result;
    assert.equal(result.alreadyPrepared, true);
    console.log('[PASS] payroll schedule prepared once and reused on re-run');
  } finally {
    await cleanup(prisma);
    await prisma.$disconnect();
  }
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
