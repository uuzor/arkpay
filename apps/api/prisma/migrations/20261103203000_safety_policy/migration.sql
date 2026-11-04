-- Payment Safety Engine: persist the policy verdict on every action.
ALTER TABLE "Action"
  ADD COLUMN "policyVersion" TEXT,
  ADD COLUMN "policyVerdict" TEXT,
  ADD COLUMN "safetySummary" TEXT;

CREATE INDEX "Action_status_createdAt_idx" ON "Action"("status", "createdAt");
