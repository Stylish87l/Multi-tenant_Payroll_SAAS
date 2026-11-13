-- Tenant payslip contact metadata and immutable earnings snapshots.
ALTER TABLE "companies"
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "contactPhone" TEXT;

ALTER TABLE "payroll_items"
  ADD COLUMN "basicSalarySnapshot" DECIMAL(18,4),
  ADD COLUMN "housingAllowanceSnapshot" DECIMAL(18,4),
  ADD COLUMN "transportAllowanceSnapshot" DECIMAL(18,4),
  ADD COLUMN "otherAllowanceSnapshot" DECIMAL(18,4);

-- Existing payroll rows intentionally remain NULL: their historical allowance split
-- cannot be reconstructed reliably from today's employee profile.
