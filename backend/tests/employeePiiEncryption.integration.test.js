import crypto from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import prisma from '../config/db.js';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;

databaseDescribe('employee PII Prisma integration', () => {
  it('encrypts writes inside interactive transactions and decrypts nested relation reads', async () => {
    const company = await prisma.company.create({ data: { name: `PII Encryption Test ${crypto.randomUUID()}` } });
    const employeeId = crypto.randomUUID();
    const email = `pii-${employeeId}@example.test`;
    const bankAccount = '001234567890';
    const ssnitNumber = `SSNIT-${employeeId.slice(0, 8)}`;
    const ghanaCardPin = `GHA-${employeeId.slice(0, 8)}-0`;

    try {
      const created = await prisma.$transaction(async (tx) => tx.employee.create({
        data: {
          id: employeeId,
          companyId: company.id,
          name: 'PII Test Employee',
          email,
          basicSalary: '1000.00',
          bankAccount,
          ssnitNumber,
          ghanaCardPin,
        },
      }));

      expect(created.bankAccount).toBe(bankAccount);
      expect(created.ssnitNumber).toBe(ssnitNumber);
      expect(created.ghanaCardPin).toBe(ghanaCardPin);

      const stored = await prisma.$queryRaw`
        SELECT "bankAccount", "ssnitNumber", "ghanaCardPin",
               "ssnit_number_hash", "ghana_card_pin_hash", "pii_encryption_version"
        FROM "employees" WHERE "id" = ${employeeId}
      `;
      expect(stored[0].bankAccount).toMatch(/^enc:v1:/);
      expect(stored[0].ssnitNumber).toMatch(/^enc:v1:/);
      expect(stored[0].ghanaCardPin).toMatch(/^enc:v1:/);
      expect(stored[0].bankAccount).not.toBe(bankAccount);
      expect(stored[0].ssnit_number_hash).toMatch(/^hmac:v1:/);
      expect(stored[0].ghana_card_pin_hash).toMatch(/^hmac:v1:/);
      expect(stored[0].pii_encryption_version).toBe(1);

      const nested = await prisma.company.findUnique({
        where: { id: company.id },
        include: { employees: true },
      });
      expect(nested.employees[0].bankAccount).toBe(bankAccount);
      expect(nested.employees[0].ssnitNumber).toBe(ssnitNumber);
      expect(nested.employees[0].ghanaCardPin).toBe(ghanaCardPin);
      expect(nested.employees[0]).not.toHaveProperty('ssnitNumberHash');
      expect(nested.employees[0]).not.toHaveProperty('ghanaCardPinHash');
      expect(nested.employees[0]).not.toHaveProperty('piiEncryptionVersion');

      const exactLookup = await prisma.employee.findFirst({
        where: { companyId: company.id, ssnitNumber },
      });
      expect(exactLookup.id).toBe(employeeId);
    } finally {
      await prisma.employee.deleteMany({ where: { companyId: company.id } });
      await prisma.company.delete({ where: { id: company.id } });
    }
  });
});
