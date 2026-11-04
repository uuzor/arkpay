-- DropIndex
DROP INDEX "Contact_name_kind_key";

-- DropIndex
DROP INDEX "Email_gmailId_key";

-- DropIndex
DROP INDEX "PayrollRun_period_key";

-- DropIndex
DROP INDEX "Schedule_systemKey_key";

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "AgentMessage" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "GmailCheckpoint" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "workspaceId" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProcessedWebhook" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'My workspace',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "gmailAddress" TEXT,
    "gmailRefreshToken" TEXT,
    "paypalClientId" TEXT,
    "paypalClientSecret" TEXT,
    "paypalMode" TEXT NOT NULL DEFAULT 'sandbox',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "telegramId" TEXT,
    "linkCode" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ownerId_key" ON "Workspace"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_workspaceId_key" ON "TelegramLink"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_telegramId_key" ON "TelegramLink"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_linkCode_key" ON "TelegramLink"("linkCode");

-- CreateIndex
CREATE INDEX "Action_workspaceId_idx" ON "Action"("workspaceId");

-- CreateIndex
CREATE INDEX "AgentMessage_workspaceId_idx" ON "AgentMessage"("workspaceId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_idx" ON "Contact"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_name_kind_key" ON "Contact"("workspaceId", "name", "kind");

-- CreateIndex
CREATE INDEX "Email_workspaceId_idx" ON "Email"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_workspaceId_gmailId_key" ON "Email"("workspaceId", "gmailId");

-- CreateIndex
CREATE INDEX "GmailCheckpoint_workspaceId_idx" ON "GmailCheckpoint"("workspaceId");

-- CreateIndex
CREATE INDEX "PayrollRun_workspaceId_idx" ON "PayrollRun"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_workspaceId_period_key" ON "PayrollRun"("workspaceId", "period");

-- CreateIndex
CREATE INDEX "ProcessedWebhook_workspaceId_idx" ON "ProcessedWebhook"("workspaceId");

-- CreateIndex
CREATE INDEX "Schedule_workspaceId_idx" ON "Schedule"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_workspaceId_systemKey_key" ON "Schedule"("workspaceId", "systemKey");

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailCheckpoint" ADD CONSTRAINT "GmailCheckpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLink" ADD CONSTRAINT "TelegramLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: all pre-tenancy rows belong to the legacy owner workspace,
-- which the first Google signup adopts (sets ownerId). Second-column values
-- were globally unique before, so the new composite uniques still hold.
INSERT INTO "Workspace" ("id", "name", "timezone", "currency", "paypalMode", "createdAt", "updatedAt")
VALUES ('owner', 'Owner workspace', 'UTC', 'USD', 'sandbox', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
UPDATE "Action" SET "workspaceId" = 'owner' WHERE "workspaceId" IS NULL;
UPDATE "AgentMessage" SET "workspaceId" = 'owner' WHERE "workspaceId" IS NULL;
UPDATE "Contact" SET "workspaceId" = 'owner' WHERE "workspaceId" IS NULL;
UPDATE "Email" SET "workspaceId" = 'owner' WHERE "workspaceId" IS NULL;
UPDATE "GmailCheckpoint" SET "workspaceId" = 'owner' WHERE "workspaceId" IS NULL;
UPDATE "PayrollRun" SET "workspaceId" = 'owner' WHERE "workspaceId" IS NULL;
UPDATE "ProcessedWebhook" SET "workspaceId" = 'owner' WHERE "workspaceId" IS NULL;
UPDATE "Schedule" SET "workspaceId" = 'owner' WHERE "workspaceId" IS NULL;
