/*
  Warnings:

  - Made the column `workspaceId` on table `Action` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `AgentMessage` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `Contact` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `Email` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `GmailCheckpoint` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `PayrollRun` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `Schedule` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Action" DROP CONSTRAINT "Action_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "AgentMessage" DROP CONSTRAINT "AgentMessage_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Email" DROP CONSTRAINT "Email_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "GmailCheckpoint" DROP CONSTRAINT "GmailCheckpoint_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "PayrollRun" DROP CONSTRAINT "PayrollRun_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "Schedule" DROP CONSTRAINT "Schedule_workspaceId_fkey";

-- AlterTable
ALTER TABLE "Action" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AgentMessage" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Email" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GmailCheckpoint" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PayrollRun" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Schedule" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailCheckpoint" ADD CONSTRAINT "GmailCheckpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
