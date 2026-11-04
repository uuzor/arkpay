-- CreateTable
CREATE TABLE "SafetyPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyPolicy_workspaceId_idx" ON "SafetyPolicy"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyPolicy_workspaceId_version_key" ON "SafetyPolicy"("workspaceId", "version");

-- AddForeignKey
ALTER TABLE "SafetyPolicy" ADD CONSTRAINT "SafetyPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
