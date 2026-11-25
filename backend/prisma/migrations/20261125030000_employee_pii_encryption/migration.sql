-- Add application-layer encrypted storage and keyed blind indexes.
-- Legacy plaintext columns remain temporarily so the maintenance backfill can migrate
-- existing rows before the new application version is allowed to serve traffic.
ALTER TABLE "employees"
  ADD COLUMN "bank_account_encrypted" TEXT,
  ADD COLUMN "ssnit_number_encrypted" TEXT,
  ADD COLUMN "ssnit_number_hash" TEXT,
  ADD COLUMN "ghana_card_pin_encrypted" TEXT,
  ADD COLUMN "ghana_card_pin_hash" TEXT;

-- Replace plaintext uniqueness with tenant-scoped blind-index uniqueness.
DROP INDEX IF EXISTS "employees_companyId_ssnitNumber_key";
DROP INDEX IF EXISTS "employees_companyId_ghanaCardPin_key";

CREATE UNIQUE INDEX "employees_companyId_ssnitNumberHash_key"
  ON "employees" ("companyId", "ssnit_number_hash");
CREATE UNIQUE INDEX "employees_companyId_ghanaCardPinHash_key"
  ON "employees" ("companyId", "ghana_card_pin_hash");
