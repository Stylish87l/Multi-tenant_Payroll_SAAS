-- DropForeignKey
ALTER TABLE "tax_configs" DROP CONSTRAINT "tax_configs_companyId_fkey";

-- AlterTable
ALTER TABLE "tax_configs" ALTER COLUMN "companyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "tax_configs" ADD CONSTRAINT "tax_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
