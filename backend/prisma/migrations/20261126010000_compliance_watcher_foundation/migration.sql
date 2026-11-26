-- Compliance Watcher foundation.
-- These records store source evidence and review decisions; they do not mutate TaxConfig
-- or finalized payroll. Statutory changes remain proposals until explicitly approved.

CREATE TYPE "ComplianceSourceStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "ComplianceChangeStatus" AS ENUM (
  'DETECTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED'
);
CREATE TYPE "ComplianceSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "ComplianceImpactStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "ComplianceReviewDecision" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CHANGES');

CREATE TABLE "compliance_sources" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT 'GH',
  "url" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
  "status" "ComplianceSourceStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastCheckedAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_changes" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "externalId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "jurisdiction" TEXT NOT NULL DEFAULT 'GH',
  "sourceUrl" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "effectiveFrom" TIMESTAMP(3),
  "evidence" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "severity" "ComplianceSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "ComplianceChangeStatus" NOT NULL DEFAULT 'DETECTED',
  "proposedConfig" JSONB,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_impacts" (
  "id" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "impactType" TEXT NOT NULL,
  "severity" "ComplianceSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "ComplianceImpactStatus" NOT NULL DEFAULT 'OPEN',
  "summary" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "compliance_impacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_reviews" (
  "id" TEXT NOT NULL,
  "changeId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "decision" "ComplianceReviewDecision" NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "compliance_sources_url_key" ON "compliance_sources"("url");
CREATE INDEX "compliance_sources_status_jurisdiction_idx" ON "compliance_sources"("status", "jurisdiction");

CREATE UNIQUE INDEX "compliance_changes_sourceId_contentHash_key" ON "compliance_changes"("sourceId", "contentHash");
CREATE UNIQUE INDEX "compliance_changes_sourceId_externalId_key" ON "compliance_changes"("sourceId", "externalId");
CREATE INDEX "compliance_changes_status_effectiveFrom_idx" ON "compliance_changes"("status", "effectiveFrom");
CREATE INDEX "compliance_changes_sourceId_publishedAt_idx" ON "compliance_changes"("sourceId", "publishedAt" DESC);

CREATE UNIQUE INDEX "compliance_impacts_changeId_companyId_key" ON "compliance_impacts"("changeId", "companyId");
CREATE INDEX "compliance_impacts_companyId_status_severity_idx" ON "compliance_impacts"("companyId", "status", "severity");
CREATE INDEX "compliance_impacts_changeId_status_idx" ON "compliance_impacts"("changeId", "status");

CREATE INDEX "compliance_reviews_changeId_createdAt_idx" ON "compliance_reviews"("changeId", "createdAt" DESC);
CREATE INDEX "compliance_reviews_actorId_createdAt_idx" ON "compliance_reviews"("actorId", "createdAt" DESC);

ALTER TABLE "compliance_changes"
  ADD CONSTRAINT "compliance_changes_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "compliance_sources"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_impacts"
  ADD CONSTRAINT "compliance_impacts_changeId_fkey"
  FOREIGN KEY ("changeId") REFERENCES "compliance_changes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "compliance_impacts_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_reviews"
  ADD CONSTRAINT "compliance_reviews_changeId_fkey"
  FOREIGN KEY ("changeId") REFERENCES "compliance_changes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "compliance_reviews_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
