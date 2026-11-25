import prisma, { disconnectDb } from '../config/db.js';
import {
  getCurrentEmployeePiiKeyId,
  getEmployeePiiCiphertextKeyId,
  reencryptSensitiveValue,
  validateEmployeePiiEncryptionConfig,
} from '../services/employeePiiEncryption.js';

const batchSize = Math.min(Math.max(Number(process.env.PII_ROTATION_BATCH_SIZE) || 200, 1), 1000);
const dryRun = process.argv.includes('--dry-run');

const main = async () => {
  validateEmployeePiiEncryptionConfig();
  const currentKeyId = getCurrentEmployeePiiKeyId();
  let cursor = null;
  let inspected = 0;
  let rotated = 0;

  for (;;) {
    const rows = cursor
      ? await prisma.$queryRaw`
          SELECT "id", "bankAccount", "ssnitNumber", "ghanaCardPin"
          FROM "employees" WHERE "pii_encryption_version" = 1 AND "id" > ${cursor}
          ORDER BY "id" ASC LIMIT ${batchSize}
        `
      : await prisma.$queryRaw`
          SELECT "id", "bankAccount", "ssnitNumber", "ghanaCardPin"
          FROM "employees" WHERE "pii_encryption_version" = 1
          ORDER BY "id" ASC LIMIT ${batchSize}
        `;
    if (!rows.length) break;

    for (const row of rows) {
      inspected += 1;
      const bankAccount = getEmployeePiiCiphertextKeyId(row.bankAccount) === currentKeyId
        ? row.bankAccount : reencryptSensitiveValue(row.bankAccount);
      const ssnitNumber = getEmployeePiiCiphertextKeyId(row.ssnitNumber) === currentKeyId
        ? row.ssnitNumber : reencryptSensitiveValue(row.ssnitNumber);
      const ghanaCardPin = getEmployeePiiCiphertextKeyId(row.ghanaCardPin) === currentKeyId
        ? row.ghanaCardPin : reencryptSensitiveValue(row.ghanaCardPin);

      if (bankAccount === row.bankAccount && ssnitNumber === row.ssnitNumber && ghanaCardPin === row.ghanaCardPin) continue;
      if (dryRun) {
        rotated += 1;
        continue;
      }

      await prisma.$executeRaw`
        UPDATE "employees"
        SET "bankAccount" = ${bankAccount},
            "ssnitNumber" = ${ssnitNumber},
            "ghanaCardPin" = ${ghanaCardPin}
        WHERE "id" = ${row.id}
      `;
      rotated += 1;
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }

  process.stdout.write(`Employee PII key rotation ${dryRun ? 'dry run' : 'completed'}: inspected ${inspected} row(s), rotated ${rotated} row(s).\n`);
};

try {
  await main();
} catch (error) {
  process.stderr.write(`Employee PII key rotation failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
