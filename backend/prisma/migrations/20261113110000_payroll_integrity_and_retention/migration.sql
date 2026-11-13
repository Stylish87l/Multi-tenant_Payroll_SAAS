-- Preflight: fail the migration with actionable diagnostics rather than silently
-- discarding identifiers or payroll rows when legacy duplicates exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "employees"
    WHERE "ssnitNumber" IS NOT NULL
    GROUP BY "companyId", "ssnitNumber" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate SSNIT numbers exist within a company; resolve them before applying tenant-scoped uniqueness.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "employees"
    WHERE "ghanaCardPin" IS NOT NULL
    GROUP BY "companyId", "ghanaCardPin" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate Ghana Card PINs exist within a company; resolve them before applying tenant-scoped uniqueness.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "payroll_items"
    GROUP BY "payrollRunId", "employeeId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate employee payroll items exist in a payroll run; reconcile them before applying the unique constraint.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "tax_configs"
    WHERE "companyId" IS NULL
    GROUP BY "type", "year", "effective_from" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate global tax configurations exist for the same effective date; reconcile them before applying uniqueness.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "tax_configs"
    WHERE "companyId" IS NOT NULL
    GROUP BY "companyId", "type", "year", "effective_from" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate tenant tax configurations exist for the same effective date; reconcile them before applying uniqueness.';
  END IF;
END $$;

-- Identifiers are unique within a tenant, not globally across unrelated companies.
DROP INDEX IF EXISTS "employees_ssnitNumber_key";
DROP INDEX IF EXISTS "employees_ghanaCardPin_key";
CREATE UNIQUE INDEX "employees_companyId_ssnitNumber_key"
  ON "employees" ("companyId", "ssnitNumber");
CREATE UNIQUE INDEX "employees_companyId_ghanaCardPin_key"
  ON "employees" ("companyId", "ghanaCardPin");

-- One employee can have only one item in a given payroll run.
CREATE UNIQUE INDEX "payroll_items_payrollRunId_employeeId_key"
  ON "payroll_items" ("payrollRunId", "employeeId");

-- PostgreSQL treats NULLs as distinct in ordinary unique indexes. Use two
-- partial indexes to enforce uniqueness for both global and tenant configs.
CREATE UNIQUE INDEX "tax_configs_global_type_year_effective_from_key"
  ON "tax_configs" ("type", "year", "effective_from")
  WHERE "companyId" IS NULL;
CREATE UNIQUE INDEX "tax_configs_company_type_year_effective_from_key"
  ON "tax_configs" ("companyId", "type", "year", "effective_from")
  WHERE "companyId" IS NOT NULL;

-- Payroll and audit history must survive employee/company/user lifecycle changes.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_companyId_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "employees_companyId_fkey";
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "employees_userId_fkey";
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_companyId_fkey";
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_processedById_fkey";
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_processedById_fkey"
  FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_items" DROP CONSTRAINT IF EXISTS "payroll_items_employeeId_fkey";
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_items" DROP CONSTRAINT IF EXISTS "payroll_items_payrollRunId_fkey";
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payrollRunId_fkey"
  FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_userId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_companyId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
