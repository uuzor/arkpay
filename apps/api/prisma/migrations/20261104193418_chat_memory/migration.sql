-- CreateTable
CREATE TABLE "ChatMemory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMemory_workspaceId_userId_idx" ON "ChatMemory"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMemory_workspaceId_userId_key_key" ON "ChatMemory"("workspaceId", "userId", "key");

-- AddForeignKey
ALTER TABLE "ChatMemory" ADD CONSTRAINT "ChatMemory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
