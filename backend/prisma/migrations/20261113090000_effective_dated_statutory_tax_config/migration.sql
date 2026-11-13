-- Effective-date statutory tax configuration.
ALTER TABLE "tax_configs"
  ADD COLUMN "effective_from" TIMESTAMPTZ NOT NULL DEFAULT '2026-01-01T00:00:00.000Z';

CREATE INDEX "tax_configs_company_type_year_effective_from_idx"
  ON "tax_configs" ("companyId", "type", "year", "effective_from");

-- SSNIT's 2026 minimum insurable earnings was revised to GH₵587.80 effective 1 Jan 2026.
UPDATE "tax_configs"
SET "config" = jsonb_set("config", '{minContributionBase}', '587.8'::jsonb, true)
WHERE "id" = 'global-ssnit-2026'
  AND "type" = 'SSNIT'
  AND "year" = 2026
  AND "companyId" IS NULL;

-- GRA's revised 2026 monthly resident PAYE bands took effect on 1 Sep 2026.
-- Preserve the existing Jan-Aug schedule for historical payroll periods.
INSERT INTO "tax_configs" ("id", "companyId", "year", "type", "config", "effective_from", "createdAt")
VALUES (
  'global-paye-2026-sep',
  NULL,
  2026,
  'PAYE',
  '{"bands":[{"limit":588,"rate":0},{"limit":80,"rate":0.05},{"limit":100,"rate":0.1},{"limit":2900,"rate":0.175},{"limit":16000,"rate":0.25},{"limit":30332,"rate":0.3},{"limit":null,"rate":0.35}],"reliefs":{"marriage":1200,"child":600,"oldAge":1500,"agedDependent":1000,"disabilityRate":0.25}}'::jsonb,
  '2026-09-01T00:00:00.000Z',
  NOW()
)
ON CONFLICT ("id") DO NOTHING;
