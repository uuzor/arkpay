import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ScheduleStatus, type Schedule } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { OWNER_WORKSPACE_ID } from '../auth/tenant.constants';
import { PrismaService } from '../prisma/prisma.service';
import { systemSeedDefinitions } from './system-seeds';
import { ScheduleHandlers } from './handlers.service';
import {
  advanceAfterRun,
  nextRunAfter,
  type ScheduleTrigger,
} from './recurrence';

export interface ScheduleInput {
  title: string;
  detail: string;
  kind: string;
  payload?: Prisma.InputJsonValue;
  status?: ScheduleStatus;
  trigger: ScheduleTrigger;
  runAt?: string | Date | null;
  intervalMinutes?: number | null;
  cron?: string | null;
  timezone?: string;
  misfirePolicy?: string;
  misfireGraceMinutes?: number;
}

export type ScheduleUpdate = Partial<ScheduleInput>;

const MAX_BATCH = 20;

/**
 * Generic runner. Schedules are data; handlers are code; ScheduleRun is the
 * timestamped history. A due row is claimed by creating a unique run for its
 * occurrence, so two ticks/processes cannot execute it twice.
 */
@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private seeded = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly handlers: ScheduleHandlers,
  ) {}

  start(): void {
    if (this.timer) return;
    if ((this.config.get<string>('SCHEDULER_ENABLED') ?? 'true') === 'false') {
      this.logger.log('Generic scheduler disabled (SCHEDULER_ENABLED=false)');
      return;
    }
    const raw = Number(
      this.config.get<string>('SCHEDULER_INTERVAL_MS') ?? 30_000,
    );
    const interval = Number.isFinite(raw) && raw >= 5_000 ? raw : 30_000;
    this.logger.log(
      `Generic scheduler starting (every ${Math.round(interval / 1000)}s)`,
    );
    void this.bootstrap();
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref?.();
  }

  private async bootstrap(): Promise<void> {
    try {
      await this.ensureDefaults();
      await this.recoverStaleRuns();
      await this.tick();
    } catch (e) {
      this.logger.error(
        `scheduler bootstrap failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Seed the business schedules once; edits/pauses survive restarts. */
  async ensureDefaults(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    if (
      (this.config.get<string>('SCHEDULER_SEED_DEFAULTS') ?? 'true') === 'false'
    ) {
      return;
    }
    // Legacy single-tenant seeds live in the owner workspace; per-workspace
    // signup seeding reuses the same definitions (see WorkspacesService).
    for (const def of systemSeedDefinitions({
      payrollCron: this.config.get<string>('PAYROLL_CRON') ?? '0 9 1 * *',
      payrollTimezone: this.config.get<string>('PAYROLL_TIMEZONE') ?? 'UTC',
      payrollEnabled:
        (this.config.get<string>('PAYROLL_ENABLED') ?? 'true') !== 'false',
      followupCron:
        this.config.get<string>('FOLLOWUP_CRON') ?? '0 */6 * * *',
      followupEnabled:
        (this.config.get<string>('FOLLOWUP_ENABLED') ?? 'false') === 'true',
    })) {
      await this.seed({ ...def, workspaceId: OWNER_WORKSPACE_ID });
    }
  }

  private async seed(
    input: ScheduleInput & { systemKey: string; workspaceId: string },
  ): Promise<void> {
    const existing = await this.prisma.schedule.findUnique({
      where: {
        workspaceId_systemKey: {
          workspaceId: input.workspaceId,
          systemKey: input.systemKey,
        },
      },
    });
    if (existing) return;
    const nextRunAt = nextRunAfter(input, new Date());
    try {
      await this.prisma.schedule.create({
        data: {
          workspaceId: input.workspaceId,
          title: input.title,
          detail: input.detail,
          kind: input.kind,
          payload: input.payload ?? {},
          status: input.status ?? ScheduleStatus.ACTIVE,
          trigger: input.trigger,
          cron: input.cron ?? null,
          timezone: input.timezone ?? 'UTC',
          misfireGraceMinutes: input.misfireGraceMinutes ?? 120,
          nextRunAt,
          systemKey: input.systemKey,
        },
      });
      this.logger.log(
        `seeded schedule "${input.title}" (${input.kind}) next=${nextRunAt?.toISOString() ?? 'never'}`,
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return;
      }
      throw e;
    }
  }

  private async recoverStaleRuns(): Promise<void> {
    const minutes = Number(
      this.config.get<string>('SCHEDULER_STALE_RUN_MINUTES') ?? 30,
    );
    const cutoff = new Date(
      Date.now() - (Number.isFinite(minutes) ? minutes : 30) * 60_000,
    );
    const stale = await this.prisma.scheduleRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: 'run was still RUNNING after the process restarted',
      },
    });
    if (stale.count > 0) {
      this.logger.warn(`recovered ${stale.count} stale schedule run(s)`);
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due = await this.prisma.schedule.findMany({
        where: { status: ScheduleStatus.ACTIVE, nextRunAt: { lte: now } },
        orderBy: { nextRunAt: 'asc' },
        take: MAX_BATCH,
      });
      for (const schedule of due) {
        await this.runOccurrence(schedule, schedule.nextRunAt ?? now, 'scheduled');
      }
    } catch (e) {
      this.logger.error(
        `scheduler tick failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async runOccurrence(
    schedule: Schedule,
    scheduledFor: Date,
    trigger: 'scheduled' | 'manual',
  ): Promise<void> {
    const now = new Date();
    if (trigger === 'scheduled' && schedule.misfirePolicy === 'skip') {
      const grace = schedule.misfireGraceMinutes * 60_000;
      if (now.getTime() - scheduledFor.getTime() > grace) {
        await this.advance(schedule, scheduledFor, now);
        this.logger.warn(
          `skipped stale occurrence ${schedule.id} scheduled for ${scheduledFor.toISOString()}`,
        );
        return;
      }
    }

    const idempotencyKey =
      trigger === 'manual'
        ? `${schedule.id}:manual:${randomUUID()}`
        : `${schedule.id}:${scheduledFor.toISOString()}`;
    let run;
    try {
      run = await this.prisma.scheduleRun.create({
        data: {
          scheduleId: schedule.id,
          scheduledFor,
          trigger,
          idempotencyKey,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Another tick/process already owns this occurrence.
        await this.advance(schedule, scheduledFor, now);
        return;
      }
      throw e;
    }

    try {
      const result = await this.handlers.dispatch(schedule, run);
      await this.prisma.scheduleRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      this.logger.log(
        `schedule ${schedule.kind} ${schedule.id} succeeded: ${result.summary}`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await this.prisma.scheduleRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: message.slice(0, 2000) },
      });
      this.logger.error(
        `schedule ${schedule.kind} ${schedule.id} failed: ${message}`,
      );
      if (message.startsWith('no handler registered')) {
        await this.prisma.schedule.updateMany({
          where: { id: schedule.id },
          data: { status: ScheduleStatus.PAUSED },
        });
        this.logger.warn(
          `paused schedule ${schedule.id}: no handler for kind ${schedule.kind}`,
        );
      }
    } finally {
      if (trigger === 'scheduled') {
        await this.advance(schedule, scheduledFor, new Date());
      } else {
        await this.prisma.schedule.updateMany({
          where: { id: schedule.id },
          data: { lastRunAt: new Date() },
        });
      }
    }
  }

  private async advance(
    schedule: Schedule,
    scheduledFor: Date,
    now: Date,
  ): Promise<void> {
    const next = advanceAfterRun(schedule, scheduledFor, now);
    await this.prisma.schedule.updateMany({
      where: {
        id: schedule.id,
        status: { in: [ScheduleStatus.ACTIVE, ScheduleStatus.PAUSED] },
      },
      data: {
        lastRunAt: now,
        nextRunAt: next,
        ...(next ? {} : { status: ScheduleStatus.DONE }),
      },
    });
  }

  list(limit = 25, workspaceId?: string) {
    return this.prisma.schedule.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }],
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            result: true,
            error: true,
          },
        },
      },
    });
  }

  get(id: string, workspaceId?: string) {
    return this.prisma.schedule.findFirst({
      where: { id, ...(workspaceId ? { workspaceId } : {}) },
      include: {
        runs: { orderBy: { startedAt: 'desc' }, take: 10 },
      },
    });
  }

  async runs(id: string, limit = 25, workspaceId?: string) {
    if (workspaceId && !(await this.get(id, workspaceId))) return [];
    return this.prisma.scheduleRun.findMany({
      where: { scheduleId: id },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async runNow(id: string, workspaceId?: string) {
    const schedule = await this.get(id, workspaceId);
    if (!schedule) throw new Error(`schedule ${id} not found`);
    if (schedule.status === ScheduleStatus.CANCELLED) {
      throw new Error('cannot run a cancelled schedule');
    }
    await this.runOccurrence(schedule, new Date(), 'manual');
    return this.prisma.scheduleRun.findFirst({
      where: { scheduleId: id },
      orderBy: { startedAt: 'desc' },
    });
  }

  async create(input: ScheduleInput, workspaceId: string) {
    const now = new Date();
    const runAt = input.runAt ? new Date(input.runAt) : null;
    // A deliberately past ONCE schedule should fire on the next tick, not
    // silently become a never-run row.
    const nextRunAt =
      input.trigger === 'ONCE' && runAt && runAt <= now
        ? runAt
        : nextRunAfter(input, now);
    return this.prisma.schedule.create({
      data: {
        workspaceId,
        title: input.title.trim(),
        detail: input.detail.trim(),
        kind: input.kind.trim(),
        payload: input.payload ?? {},
        status: input.status ?? ScheduleStatus.ACTIVE,
        trigger: input.trigger,
        runAt: input.runAt ? new Date(input.runAt) : null,
        intervalMinutes: input.intervalMinutes ?? null,
        cron: input.cron?.trim() || null,
        timezone: input.timezone?.trim() || 'UTC',
        misfirePolicy: input.misfirePolicy ?? 'run_once',
        misfireGraceMinutes: input.misfireGraceMinutes ?? 120,
        nextRunAt,
        systemKey: null,
      },
    });
  }

  async update(id: string, changes: ScheduleUpdate, workspaceId?: string) {
    const current = await this.get(id, workspaceId);
    if (!current) throw new Error(`schedule ${id} not found`);
    const merged = {
      title: changes.title?.trim() ?? current.title,
      detail: changes.detail?.trim() ?? current.detail,
      kind: changes.kind?.trim() ?? current.kind,
      payload: changes.payload ?? (current.payload as Prisma.InputJsonValue),
      status: changes.status ?? current.status,
      trigger: changes.trigger ?? current.trigger,
      runAt: changes.runAt ?? current.runAt,
      intervalMinutes: changes.intervalMinutes ?? current.intervalMinutes,
      cron: changes.cron ?? current.cron,
      timezone: changes.timezone ?? current.timezone,
      misfirePolicy: changes.misfirePolicy ?? current.misfirePolicy,
      misfireGraceMinutes:
        changes.misfireGraceMinutes ?? current.misfireGraceMinutes,
    };
    const shouldRecompute =
      changes.trigger !== undefined ||
      changes.runAt !== undefined ||
      changes.intervalMinutes !== undefined ||
      changes.cron !== undefined ||
      changes.timezone !== undefined ||
      changes.status === ScheduleStatus.ACTIVE;
    let nextRunAt = current.nextRunAt;
    if (shouldRecompute && merged.status === ScheduleStatus.ACTIVE) {
      nextRunAt = nextRunAfter(merged, new Date());
    }
    return this.prisma.schedule.update({
      where: { id },
      data: {
        ...merged,
        nextRunAt,
      },
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
