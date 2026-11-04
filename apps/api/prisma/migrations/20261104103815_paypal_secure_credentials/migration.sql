-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "paypalAccountId" TEXT,
ADD COLUMN     "paypalAppId" TEXT,
ADD COLUMN     "paypalScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
