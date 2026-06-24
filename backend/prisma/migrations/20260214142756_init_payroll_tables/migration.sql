/*
  Warnings:

  - You are about to drop the column `tokenHash` on the `refresh_tokens` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[companyId,email]` on the table `employees` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tokenId]` on the table `refresh_tokens` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[companyId,email]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tokenId` to the `refresh_tokens` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SYSTEM';
ALTER TYPE "NotificationType" ADD VALUE 'REMINDER';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CUSTOM';

-- DropIndex
DROP INDEX "employees_companyId_email_idx";

-- DropIndex
DROP INDEX "refresh_tokens_tokenHash_key";

-- DropIndex
DROP INDEX "users_email_key";

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "performedBy" TEXT,
ADD COLUMN     "resourceId" TEXT,
ADD COLUMN     "resourceType" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "basicSalary" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "housingAllowance" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "transportAllowance" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "otherAllowance" SET DATA TYPE DECIMAL(18,4);

-- AlterTable
ALTER TABLE "payroll_items" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "grossSalary" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "taxableIncome" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "ssnitEmployee" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "ssnitEmployer" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "ssnitTier1" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "ssnitTier2" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "payeTax" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "netPay" SET DATA TYPE DECIMAL(18,4);

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "tokenHash",
ADD COLUMN     "deviceInfo" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "revocationReason" TEXT,
ADD COLUMN     "revokedBy" TEXT,
ADD COLUMN     "tokenId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_email_key" ON "employees"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenId_key" ON "refresh_tokens"("tokenId");

-- CreateIndex
CREATE INDEX "refresh_tokens_tokenId_idx" ON "refresh_tokens"("tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "users_companyId_email_key" ON "users"("companyId", "email");
