CREATE TABLE "compliance_sources" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "poll_interval_minutes" INTEGER NOT NULL DEFAULT 360,
  "etag" TEXT,
  "last_modified" TEXT,
  "last_content_hash" TEXT,
  "last_checked_at" TIMESTAMPTZ(3),
  "last_status" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_notices" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "excerpt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_notices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_notices_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "compliance_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "compliance_assessments" (
  "id" TEXT NOT NULL,
  "notice_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "impact_areas" JSONB NOT NULL,
  "proposed_actions" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_assessments_notice_id_fkey"
    FOREIGN KEY ("notice_id") REFERENCES "compliance_notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "compliance_assessments_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "compliance_assessments_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "compliance_sources_url_key" ON "compliance_sources"("url");
CREATE INDEX "compliance_sources_active_last_checked_at_idx" ON "compliance_sources"("active", "last_checked_at");
CREATE UNIQUE INDEX "compliance_notices_source_id_content_hash_key" ON "compliance_notices"("source_id", "content_hash");
CREATE INDEX "compliance_notices_status_detected_at_idx" ON "compliance_notices"("status", "detected_at" DESC);
CREATE UNIQUE INDEX "compliance_assessments_notice_id_company_id_key" ON "compliance_assessments"("notice_id", "company_id");
CREATE INDEX "compliance_assessments_company_id_created_at_idx" ON "compliance_assessments"("company_id", "created_at" DESC);
CREATE INDEX "compliance_assessments_notice_id_status_idx" ON "compliance_assessments"("notice_id", "status");

INSERT INTO "compliance_sources" ("id", "name", "authority", "topic", "url") VALUES
  ('gra-paye', 'GRA PAYE guidance', 'Ghana Revenue Authority', 'PAYE', 'https://gra.gov.gh/domestic-tax/tax-types/paye/'),
  ('gra-tax-amendments', 'GRA tax law amendments', 'Ghana Revenue Authority', 'GENERAL_TAX', 'https://gra.gov.gh/amendments-of-tax-laws/'),
  ('ssnit-employer-guidance', 'SSNIT employer guidance', 'Social Security and National Insurance Trust', 'SSNIT', 'https://www.ssnit.org.gh/become-an-employer/');
