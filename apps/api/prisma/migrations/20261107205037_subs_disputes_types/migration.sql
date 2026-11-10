-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActionType" ADD VALUE 'SUBSCRIPTION_CANCEL';
ALTER TYPE "ActionType" ADD VALUE 'SUBSCRIPTION_SUSPEND';
ALTER TYPE "ActionType" ADD VALUE 'SUBSCRIPTION_ACTIVATE';
ALTER TYPE "ActionType" ADD VALUE 'DISPUTE_MESSAGE';
ALTER TYPE "ActionType" ADD VALUE 'DISPUTE_OFFER';
ALTER TYPE "ActionType" ADD VALUE 'DISPUTE_EVIDENCE';
ALTER TYPE "ActionType" ADD VALUE 'DISPUTE_ACCEPT_CLAIM';
