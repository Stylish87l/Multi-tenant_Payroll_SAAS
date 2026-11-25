CREATE TABLE "employee_import_previews" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payload_encrypted" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_import_previews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_import_previews_scope_idx"
ON "employee_import_previews"("companyId", "userId", "status", "expires_at");

ALTER TABLE "employee_import_previews"
ADD CONSTRAINT "employee_import_previews_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_import_previews"
ADD CONSTRAINT "employee_import_previews_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
