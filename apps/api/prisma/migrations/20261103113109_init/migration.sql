-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('CLIENT', 'SUPPLIER', 'STAFF');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('INVOICE', 'PAYOUT_SINGLE', 'PAYOUT_BATCH');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED', 'BLOCKED', 'IGNORED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('NEW', 'PROCESSED', 'NEEDS_REVIEW', 'IGNORED');

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,
    "threadId" TEXT,
    "from" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'NEW',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paypalEmail" TEXT,
    "kind" "ContactKind" NOT NULL,
    "usualAmount" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPaidAt" TIMESTAMP(3),
    "payCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "emailId" TEXT,
    "contactId" TEXT,
    "payeeName" TEXT NOT NULL,
    "payeePaypal" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "extractedJson" JSONB NOT NULL,
    "riskFlags" TEXT[],
    "confidence" DOUBLE PRECISION,
    "actionHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "batchId" TEXT,
    "paypalRef" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "batchId" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Email_gmailId_key" ON "Email"("gmailId");

-- CreateIndex
CREATE INDEX "Email_status_idx" ON "Email"("status");

-- CreateIndex
CREATE INDEX "Contact_paypalEmail_idx" ON "Contact"("paypalEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_name_kind_key" ON "Contact"("name", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Action_idempotencyKey_key" ON "Action"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Action_status_idx" ON "Action"("status");

-- CreateIndex
CREATE INDEX "Action_batchId_idx" ON "Action"("batchId");

-- CreateIndex
CREATE INDEX "AuditLog_actionId_idx" ON "AuditLog"("actionId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_period_key" ON "PayrollRun"("period");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_batchId_key" ON "PayrollRun"("batchId");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
