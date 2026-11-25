import prisma, { disconnectDb } from '../config/db.js';
import {
  createEmployeePiiBlindIndex,
  encryptSensitiveValue,
  validateEmployeePiiEncryptionConfig,
} from '../services/employeePiiEncryption.js';

const batchSize = Math.min(Math.max(Number(process.env.PII_BACKFILL_BATCH_SIZE) || 200, 1), 1000);
const dryRun = process.argv.includes('--dry-run');

const main = async () => {
  validateEmployeePiiEncryptionConfig();
  let processed = 0;

  for (;;) {
    const rows = await prisma.$queryRaw`
      SELECT
        "id",
        "bankAccount",
        "ssnitNumber",
        "ghanaCardPin",
        "bank_account_encrypted" AS "bankAccountEncrypted",
        "ssnit_number_encrypted" AS "ssnitNumberEncrypted",
        "ssnit_number_hash" AS "ssnitNumberHash",
        "ghana_card_pin_encrypted" AS "ghanaCardPinEncrypted",
        "ghana_card_pin_hash" AS "ghanaCardPinHash"
      FROM "employees"
      WHERE "bankAccount" IS NOT NULL
         OR "ssnitNumber" IS NOT NULL
         OR "ghanaCardPin" IS NOT NULL
      ORDER BY "id" ASC
      LIMIT ${batchSize}
    `;
    if (!rows.length) break;
    if (dryRun) {
      processed += rows.length;
      break;
    }

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const bankAccountEncrypted = row.bankAccountEncrypted || encryptSensitiveValue(row.bankAccount);
        const ssnitNumberEncrypted = row.ssnitNumberEncrypted || encryptSensitiveValue(row.ssnitNumber);
        const ssnitNumberHash = row.ssnitNumberHash || createEmployeePiiBlindIndex(row.ssnitNumber, 'ssnitNumber');
        const ghanaCardPinEncrypted = row.ghanaCardPinEncrypted || encryptSensitiveValue(row.ghanaCardPin);
        const ghanaCardPinHash = row.ghanaCardPinHash || createEmployeePiiBlindIndex(row.ghanaCardPin, 'ghanaCardPin');

        await tx.$executeRaw`
          UPDATE "employees"
          SET
            "bank_account_encrypted" = COALESCE("bank_account_encrypted", ${bankAccountEncrypted}),
            "ssnit_number_encrypted" = COALESCE("ssnit_number_encrypted", ${ssnitNumberEncrypted}),
            "ssnit_number_hash" = COALESCE("ssnit_number_hash", ${ssnitNumberHash}),
            "ghana_card_pin_encrypted" = COALESCE("ghana_card_pin_encrypted", ${ghanaCardPinEncrypted}),
            "ghana_card_pin_hash" = COALESCE("ghana_card_pin_hash", ${ghanaCardPinHash}),
            "bankAccount" = NULL,
            "ssnitNumber" = NULL,
            "ghanaCardPin" = NULL
          WHERE "id" = ${row.id}
        `;
      }
    });
    processed += rows.length;
  }

  if (!dryRun) {
    const remaining = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "count"
      FROM "employees"
      WHERE "bankAccount" IS NOT NULL
         OR "ssnitNumber" IS NOT NULL
         OR "ghanaCardPin" IS NOT NULL
    `;
    if (Number(remaining[0]?.count || 0) !== 0) {
      throw new Error('Employee PII backfill incomplete; plaintext values remain in legacy columns.');
    }
  }

  process.stdout.write(`Employee PII backfill ${dryRun ? 'dry run' : 'completed'}: ${processed} row(s) inspected.\n`);
};

try {
  await main();
} catch (error) {
  process.stderr.write(`Employee PII backfill failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
