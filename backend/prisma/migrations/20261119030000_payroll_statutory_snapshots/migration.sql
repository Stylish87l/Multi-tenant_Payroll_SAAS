-- Preserve the exact statutory tables and employee relief inputs used to
-- calculate each run. Existing historical runs remain NULL rather than being
-- backfilled with today's configuration, which would be misleading.
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS "taxConfigSnapshot" JSONB;

ALTER TABLE payroll_items
  ADD COLUMN IF NOT EXISTS "reliefInputsSnapshot" JSONB;
