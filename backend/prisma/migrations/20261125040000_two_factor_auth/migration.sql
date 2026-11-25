ALTER TABLE "users"
  ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "two_factor_secret_encrypted" TEXT,
  ADD COLUMN "two_factor_verified_at" TIMESTAMP(3),
  ADD COLUMN "two_factor_last_counter" BIGINT;

CREATE TABLE "two_factor_recovery_codes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "two_factor_recovery_codes_userId_codeHash_key"
  ON "two_factor_recovery_codes"("userId", "codeHash");
CREATE INDEX "two_factor_recovery_codes_userId_usedAt_idx"
  ON "two_factor_recovery_codes"("userId", "usedAt");

ALTER TABLE "two_factor_recovery_codes"
  ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
