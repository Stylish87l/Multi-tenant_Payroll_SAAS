-- Store the provider-specific bank code separately from the human-readable bank name.
ALTER TABLE "employees" ADD COLUMN "bankCode" TEXT;
