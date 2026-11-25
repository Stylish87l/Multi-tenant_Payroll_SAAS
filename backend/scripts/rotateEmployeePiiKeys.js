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
          SELECT "id", "bank_account_encrypted", "ssnit_number_encrypted", "ghana_card_pin_encrypted"
          FROM "employees" WHERE "id" > ${cursor}
          ORDER BY "id" ASC LIMIT ${batchSize}
        `
      : await prisma.$queryRaw`
          SELECT "id", "bank_account_encrypted", "ssnit_number_encrypted", "ghana_card_pin_encrypted"
          FROM "employees" ORDER BY "id" ASC LIMIT ${batchSize}
        `;
    if (!rows.length) break;

    for (const row of rows) {
      inspected += 1;
      const bankAccount = getEmployeePiiCiphertextKeyId(row.bank_account_encrypted) === currentKeyId
        ? row.bank_account_encrypted : reencryptSensitiveValue(row.bank_account_encrypted);
      const ssnitNumber = getEmployeePiiCiphertextKeyId(row.ssnit_number_encrypted) === currentKeyId
        ? row.ssnit_number_encrypted : reencryptSensitiveValue(row.ssnit_number_encrypted);
      const ghanaCardPin = getEmployeePiiCiphertextKeyId(row.ghana_card_pin_encrypted) === currentKeyId
        ? row.ghana_card_pin_encrypted : reencryptSensitiveValue(row.ghana_card_pin_encrypted);

      if (bankAccount === row.bank_account_encrypted
        && ssnitNumber === row.ssnit_number_encrypted
        && ghanaCardPin === row.ghana_card_pin_encrypted) continue;
      if (dryRun) {
        rotated += 1;
        continue;
      }

      await prisma.$executeRaw`
        UPDATE "employees"
        SET
          "bank_account_encrypted" = ${bankAccount},
          "ssnit_number_encrypted" = ${ssnitNumber},
          "ghana_card_pin_encrypted" = ${ghanaCardPin}
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
