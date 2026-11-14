CREATE TYPE "BackgroundJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "background_jobs" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "companyId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "status" "BackgroundJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockToken" TEXT,
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "background_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "background_jobs_idempotencyKey_key" ON "background_jobs"("idempotencyKey");
CREATE INDEX "background_jobs_status_availableAt_idx" ON "background_jobs"("status", "availableAt");
CREATE INDEX "background_jobs_companyId_createdAt_idx" ON "background_jobs"("companyId", "createdAt");
