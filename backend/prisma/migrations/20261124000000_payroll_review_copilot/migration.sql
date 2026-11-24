CREATE TYPE "PayrollReviewStatus" AS ENUM ('COMPLETED', 'FAILED');
CREATE TYPE "PayrollFindingSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "PayrollFindingStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED', 'RESOLVED');
CREATE TYPE "PayrollReviewDecision" AS ENUM ('CONFIRMED', 'DISMISSED', 'NEEDS_INVESTIGATION', 'RESOLVED');

CREATE TABLE "payroll_reviews" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "payrollRunId" TEXT NOT NULL,
  "requestedById" TEXT,
  "status" "PayrollReviewStatus" NOT NULL DEFAULT 'COMPLETED',
  "summary" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_review_findings" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT,
  "code" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" "PayrollFindingSeverity" NOT NULL,
  "status" "PayrollFindingStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "recommendation" TEXT NOT NULL,
  "aiExplanation" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_review_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_review_actions" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "decision" "PayrollReviewDecision" NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_review_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_reviews_companyId_createdAt_idx" ON "payroll_reviews"("companyId", "createdAt" DESC);
CREATE INDEX "payroll_reviews_payrollRunId_idx" ON "payroll_reviews"("payrollRunId");
CREATE INDEX "payroll_review_findings_companyId_status_idx" ON "payroll_review_findings"("companyId", "status");
CREATE INDEX "payroll_review_findings_reviewId_severity_idx" ON "payroll_review_findings"("reviewId", "severity");
CREATE INDEX "payroll_review_findings_employeeId_idx" ON "payroll_review_findings"("employeeId");
CREATE INDEX "payroll_review_actions_companyId_createdAt_idx" ON "payroll_review_actions"("companyId", "createdAt" DESC);
CREATE INDEX "payroll_review_actions_findingId_createdAt_idx" ON "payroll_review_actions"("findingId", "createdAt" DESC);

ALTER TABLE "payroll_reviews" ADD CONSTRAINT "payroll_reviews_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_reviews" ADD CONSTRAINT "payroll_reviews_payrollRunId_fkey"
  FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_reviews" ADD CONSTRAINT "payroll_reviews_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_review_findings" ADD CONSTRAINT "payroll_review_findings_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "payroll_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_review_findings" ADD CONSTRAINT "payroll_review_findings_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_review_findings" ADD CONSTRAINT "payroll_review_findings_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_review_actions" ADD CONSTRAINT "payroll_review_actions_findingId_fkey"
  FOREIGN KEY ("findingId") REFERENCES "payroll_review_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_review_actions" ADD CONSTRAINT "payroll_review_actions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_review_actions" ADD CONSTRAINT "payroll_review_actions_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
