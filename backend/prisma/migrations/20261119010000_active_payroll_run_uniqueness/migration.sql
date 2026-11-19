-- Financial payroll records are retained. A cancelled draft is soft-deleted
-- (deletedAt IS NOT NULL), allowing a corrected draft for the same month.
DROP INDEX IF EXISTS "payroll_runs_companyId_month_key";

CREATE UNIQUE INDEX "payroll_runs_companyId_month_active_key"
  ON "payroll_runs" ("companyId", "month")
  WHERE "deletedAt" IS NULL;
