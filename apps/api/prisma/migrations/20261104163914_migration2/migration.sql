-- AlterEnum
ALTER TYPE "EmailStatus" ADD VALUE 'AWAITING_CONFIRM';

-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "extractedJson" JSONB;
