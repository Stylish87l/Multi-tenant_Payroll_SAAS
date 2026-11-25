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

  if (dryRun) {
    const total = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "count"
      FROM "employees"
      WHERE "pii_encryption_version" IS DISTINCT FROM 1
    `;
    process.stdout.write(`Employee PII backfill dry run: ${Number(total[0]?.count || 0)} row(s) require migration.\n`);
    return;
  }

  for (;;) {
    const rows = await prisma.$queryRaw`
      SELECT "id", "bankAccount", "ssnitNumber", "ghanaCardPin"
      FROM "employees"
      WHERE "pii_encryption_version" IS DISTINCT FROM 1
      ORDER BY "id" ASC
      LIMIT ${batchSize}
    `;
    if (!rows.length) break;

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const bankAccount = encryptSensitiveValue(row.bankAccount);
        const ssnitNumber = encryptSensitiveValue(row.ssnitNumber);
        const ssnitNumberHash = createEmployeePiiBlindIndex(row.ssnitNumber, 'ssnitNumber');
        const ghanaCardPin = encryptSensitiveValue(row.ghanaCardPin);
        const ghanaCardPinHash = createEmployeePiiBlindIndex(row.ghanaCardPin, 'ghanaCardPin');

        await tx.$executeRaw`
          UPDATE "employees"
          SET
            "bankAccount" = ${bankAccount},
            "ssnitNumber" = ${ssnitNumber},
            "ssnit_number_hash" = ${ssnitNumberHash},
            "ghana_card_pin_hash" = ${ghanaCardPinHash},
            "pii_encryption_version" = 1
          WHERE "id" = ${row.id}
        `;
      }
    }, { maxWait: 10_000, timeout: 60_000 });
    processed += rows.length;
  }

  const remaining = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS "count"
    FROM "employees"
    WHERE "pii_encryption_version" IS DISTINCT FROM 1
       OR ("bankAccount" IS NOT NULL AND "bankAccount" NOT LIKE 'enc:v1:%')
       OR ("ssnitNumber" IS NOT NULL AND "ssnitNumber" NOT LIKE 'enc:v1:%')
       OR ("ghanaCardPin" IS NOT NULL AND "ghanaCardPin" NOT LIKE 'enc:v1:%')
  `;
  if (Number(remaining[0]?.count || 0) !== 0) {
    throw new Error('Employee PII backfill incomplete; unencrypted employee records remain.');
  }

  process.stdout.write(`Employee PII backfill completed: ${processed} row(s) encrypted.\n`);
};

try {
  await main();
} catch (error) {
  process.stderr.write(`Employee PII backfill failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
