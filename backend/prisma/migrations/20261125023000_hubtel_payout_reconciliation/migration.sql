ALTER TABLE "payroll_items"
  ADD COLUMN "payout_provider" TEXT,
  ADD COLUMN "provider_transaction_id" TEXT,
  ADD COLUMN "payout_submitted_at" TIMESTAMPTZ(3),
  ADD COLUMN "payout_last_checked_at" TIMESTAMPTZ(3);

CREATE INDEX "payroll_items_payout_provider_status_idx"
  ON "payroll_items" ("payout_provider", "payment_status");
