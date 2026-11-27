ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMPLIANCE_SPECIALIST';

ALTER TABLE "compliance_assessments"
  ADD COLUMN "submitted_at" TIMESTAMPTZ(3),
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(3);

CREATE TABLE "compliance_specialist_access" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "granted_by_id" TEXT NOT NULL,
  "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "compliance_specialist_access_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_specialist_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "compliance_specialist_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "compliance_specialist_access_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "compliance_specialist_access_user_id_company_id_key" ON "compliance_specialist_access"("user_id", "company_id");
CREATE INDEX "compliance_specialist_access_company_id_revoked_at_idx" ON "compliance_specialist_access"("company_id", "revoked_at");
CREATE INDEX "compliance_specialist_access_user_id_revoked_at_idx" ON "compliance_specialist_access"("user_id", "revoked_at");

CREATE TABLE "compliance_assessment_reviews" (
  "id" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_assessment_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_assessment_reviews_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "compliance_assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "compliance_assessment_reviews_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "compliance_assessment_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "compliance_assessment_reviews_assessment_id_created_at_idx" ON "compliance_assessment_reviews"("assessment_id", "created_at" DESC);
CREATE INDEX "compliance_assessment_reviews_company_id_created_at_idx" ON "compliance_assessment_reviews"("company_id", "created_at" DESC);

-- Review decisions are append-only; corrections are new review events, never edits.
CREATE FUNCTION prevent_compliance_review_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Compliance assessment review history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "compliance_assessment_reviews_no_update"
  BEFORE UPDATE OR DELETE ON "compliance_assessment_reviews"
  FOR EACH ROW EXECUTE FUNCTION prevent_compliance_review_mutation();
