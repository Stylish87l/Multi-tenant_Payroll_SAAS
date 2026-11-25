-- Add keyed blind indexes and a per-record encryption version marker.
-- Existing bankAccount/ssnitNumber/ghanaCardPin columns are encrypted in place by
-- the maintenance backfill before the new application is allowed to serve traffic.
ALTER TABLE "employees"
  ADD COLUMN "ssnit_number_hash" TEXT,
  ADD COLUMN "ghana_card_pin_hash" TEXT,
  ADD COLUMN "pii_encryption_version" INTEGER;

-- Replace plaintext uniqueness with tenant-scoped blind-index uniqueness.
DROP INDEX IF EXISTS "employees_companyId_ssnitNumber_key";
DROP INDEX IF EXISTS "employees_companyId_ghanaCardPin_key";

CREATE UNIQUE INDEX "employees_companyId_ssnitNumberHash_key"
  ON "employees" ("companyId", "ssnit_number_hash");
CREATE UNIQUE INDEX "employees_companyId_ghanaCardPinHash_key"
  ON "employees" ("companyId", "ghana_card_pin_hash");
