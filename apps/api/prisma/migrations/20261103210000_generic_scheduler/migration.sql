-- Generic schedule engine.
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DONE', 'CANCELLED');
CREATE TYPE "ScheduleRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

ALTER TABLE "PayrollRun"
  ADD COLUMN "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "preparedBy" TEXT NOT NULL DEFAULT 'scheduler',
  ADD COLUMN "note" TEXT,
  ADD COLUMN "skippedReason" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "trigger" TEXT NOT NULL,
    "runAt" TIMESTAMP(3),
    "intervalMinutes" INTEGER,
    "cron" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "misfirePolicy" TEXT NOT NULL DEFAULT 'run_once',
    "misfireGraceMinutes" INTEGER NOT NULL DEFAULT 120,
    "systemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduleRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "ScheduleRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "idempotencyKey" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Schedule_systemKey_key" ON "Schedule"("systemKey");
CREATE INDEX "Schedule_status_nextRunAt_idx" ON "Schedule"("status", "nextRunAt");
CREATE INDEX "Schedule_kind_idx" ON "Schedule"("kind");
CREATE INDEX "PayrollRun_status_createdAt_idx" ON "PayrollRun"("status", "createdAt");
CREATE UNIQUE INDEX "ScheduleRun_idempotencyKey_key" ON "ScheduleRun"("idempotencyKey");
CREATE UNIQUE INDEX "ScheduleRun_scheduleId_scheduledFor_key" ON "ScheduleRun"("scheduleId", "scheduledFor");
CREATE INDEX "ScheduleRun_scheduleId_startedAt_idx" ON "ScheduleRun"("scheduleId", "startedAt");
CREATE INDEX "ScheduleRun_status_startedAt_idx" ON "ScheduleRun"("status", "startedAt");

ALTER TABLE "ScheduleRun" ADD CONSTRAINT "ScheduleRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
