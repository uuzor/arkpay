-- CreateTable
CREATE TABLE "GmailCheckpoint" (
    "mailbox" TEXT NOT NULL,
    "historyId" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailCheckpoint_pkey" PRIMARY KEY ("mailbox")
);
