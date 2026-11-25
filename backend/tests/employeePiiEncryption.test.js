import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createEmployeePiiBlindIndex,
  createEmployeePiiEncryptionExtension,
  decryptEmployeePiiResults,
  decryptSensitiveValue,
  encryptEmployeeWriteData,
  encryptSensitiveValue,
  getEmployeePiiCiphertextKeyId,
  reencryptSensitiveValue,
  validateEmployeePiiEncryptionConfig,
} from '../services/employeePiiEncryption.js';

const originalEnv = { ...process.env };
const key = Buffer.alloc(32, 0x31).toString('base64');
const indexKey = Buffer.alloc(32, 0x52).toString('base64');

describe('employee PII encryption', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATA_ENCRYPTION_KEY = key;
    process.env.DATA_ENCRYPTION_KEY_ID = 'test-key';
    process.env.DATA_ENCRYPTION_INDEX_KEY = indexKey;
    delete process.env.DATA_ENCRYPTION_PREVIOUS_KEYS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('encrypts with AES-256-GCM and decrypts the original value', () => {
    const encrypted = encryptSensitiveValue('123-45-6789');
    expect(encrypted).toMatch(/^enc:v1:test-key:/);
    expect(encrypted).not.toContain('123-45-6789');
    expect(decryptSensitiveValue(encrypted)).toBe('123-45-6789');
  });

  it('uses a fresh nonce for every value, including ciphertext-looking user input', () => {
    const first = encryptSensitiveValue('GHA-123456789-0');
    const second = encryptSensitiveValue('GHA-123456789-0');
    expect(first).not.toBe(second);
    const nested = encryptSensitiveValue(first);
    expect(nested).not.toBe(first);
    expect(decryptSensitiveValue(nested)).toBe(first);
  });

  it('supports decrypting and re-encrypting old keys during key rotation', () => {
    process.env.DATA_ENCRYPTION_KEY_ID = 'old-key';
    const oldCiphertext = encryptSensitiveValue('old-value');
    process.env.DATA_ENCRYPTION_KEY_ID = 'new-key';
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 0x77).toString('base64');
    process.env.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ 'old-key': key });
    expect(decryptSensitiveValue(oldCiphertext)).toBe('old-value');
    const rotated = reencryptSensitiveValue(oldCiphertext);
    expect(getEmployeePiiCiphertextKeyId(rotated)).toBe('new-key');
    expect(decryptSensitiveValue(rotated)).toBe('old-value');
    expect(decryptSensitiveValue(encryptSensitiveValue('new-value'))).toBe('new-value');
  });

  it('fails closed for malformed ciphertext and unknown key IDs', () => {
    expect(() => decryptSensitiveValue('plain-text')).toThrow(/backfill/);
    expect(() => decryptSensitiveValue('enc:v1:missing:AA:AA:AA')).toThrow(/not configured/);
  });

  it('creates stable, field-separated HMAC blind indexes without storing identifiers', () => {
    const first = createEmployeePiiBlindIndex('SSNIT-123 456', 'ssnitNumber');
    const normalized = createEmployeePiiBlindIndex('ssnit-123 456', 'ssnitNumber');
    const otherField = createEmployeePiiBlindIndex('SSNIT-123 456', 'ghanaCardPin');
    expect(first).toBe(normalized);
    expect(first).not.toBe(otherField);
    expect(first).not.toContain('SSNIT-123');
    expect(first).toMatch(/^hmac:v1:[a-f0-9]{64}$/);
  });

  it('encrypts all sensitive employee write fields and removes plaintext identifiers from the write payload', () => {
    const data = encryptEmployeeWriteData({
      name: 'Employee',
      bankAccount: '0012345678',
      ssnitNumber: 'SSNIT-123456',
      ghanaCardPin: 'GHA-123456789-0',
    }, { markVersion: true });
    expect(data).toHaveProperty('name', 'Employee');
    expect(decryptSensitiveValue(data.bankAccount)).toBe('0012345678');
    expect(decryptSensitiveValue(data.ssnitNumber)).toBe('SSNIT-123456');
    expect(decryptSensitiveValue(data.ghanaCardPin)).toBe('GHA-123456789-0');
    expect(data.ssnitNumberHash).toMatch(/^hmac:v1:/);
    expect(data.ghanaCardPinHash).toMatch(/^hmac:v1:/);
    expect(data.piiEncryptionVersion).toBe(1);
  });

  it('encrypts Prisma scalar set operations and derives matching blind indexes', () => {
    const data = encryptEmployeeWriteData({
      ssnitNumber: { set: 'SSNIT-SET-123' },
      ghanaCardPin: { set: 'GHA-SET-123' },
    });
    expect(decryptSensitiveValue(data.ssnitNumber)).toBe('SSNIT-SET-123');
    expect(decryptSensitiveValue(data.ghanaCardPin)).toBe('GHA-SET-123');
    expect(data.ssnitNumberHash).toBe(createEmployeePiiBlindIndex('SSNIT-SET-123', 'ssnitNumber'));
    expect(data.ghanaCardPinHash).toBe(createEmployeePiiBlindIndex('GHA-SET-123', 'ghanaCardPin'));
  });

  it('clears encrypted values and blind indexes when a field is explicitly cleared', () => {
    expect(encryptEmployeeWriteData({
      bankAccount: null, ssnitNumber: null, ghanaCardPin: null,
    })).toMatchObject({
      bankAccount: null,
      ssnitNumber: null,
      ssnitNumberHash: null,
      ghanaCardPin: null,
      ghanaCardPinHash: null,
      piiEncryptionVersion: 1,
    });
  });

  it('encrypts direct Employee writes and decrypts returned records', async () => {
    const extension = createEmployeePiiEncryptionExtension();
    let persisted;
    const query = jest.fn(async (args) => {
      persisted = { ...args.data };
      return { ...args.data };
    });
    const args = { data: { bankAccount: '12345678', ssnitNumber: '123-456' } };
    const result = await extension.query.$allModels.$allOperations({
      model: 'Employee', operation: 'create', args, query,
    });
    expect(persisted.bankAccount).not.toBe('12345678');
    expect(decryptSensitiveValue(persisted.bankAccount)).toBe('12345678');
    expect(decryptSensitiveValue(persisted.ssnitNumber)).toBe('123-456');
    expect(result.bankAccount).toBe('12345678');
    expect(result.ssnitNumber).toBe('123-456');
    expect(result).not.toHaveProperty('ssnitNumberHash');
    expect(result).not.toHaveProperty('piiEncryptionVersion');
  });

  it('decrypts Employee records nested inside other model results', () => {
    const nested = {
      payrollItem: {
        employee: {
          id: 'employee-1',
          name: 'Employee',
          bankAccount: encryptSensitiveValue('12345678'),
          ssnitNumber: encryptSensitiveValue('123-456'),
          ssnitNumberHash: createEmployeePiiBlindIndex('123-456', 'ssnitNumber'),
          piiEncryptionVersion: 1,
        },
      },
    };
    const result = decryptEmployeePiiResults(nested);
    expect(result.payrollItem.employee.bankAccount).toBe('12345678');
    expect(result.payrollItem.employee.ssnitNumber).toBe('123-456');
    expect(result.payrollItem.employee).not.toHaveProperty('ssnitNumberHash');
    expect(result.payrollItem.employee).not.toHaveProperty('piiEncryptionVersion');
  });

  it('rewrites exact identifier filters to blind indexes', async () => {
    const extension = createEmployeePiiEncryptionExtension();
    const query = jest.fn(async () => ({ count: 0 }));
    const args = { where: { OR: [{ ssnitNumber: '123-456' }, { ghanaCardPin: { equals: 'GHA-123' } }] } };
    await extension.query.$allModels.$allOperations({ model: 'Employee', operation: 'findMany', args, query });
    const where = query.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ ssnitNumberHash: createEmployeePiiBlindIndex('123-456', 'ssnitNumber') });
    expect(where.OR[1]).toEqual({ ghanaCardPinHash: { equals: createEmployeePiiBlindIndex('GHA-123', 'ghanaCardPin') } });
  });

  it('rewrites exact filters through nested Employee relations', async () => {
    const extension = createEmployeePiiEncryptionExtension();
    const query = jest.fn(async () => ({ count: 0 }));
    const args = { where: { employee: { is: { ssnitNumber: '123-456' } } } };
    await extension.query.$allModels.$allOperations({ model: 'PayrollItem', operation: 'findMany', args, query });
    expect(query.mock.calls[0][0].where.employee.is).toEqual({
      ssnitNumberHash: createEmployeePiiBlindIndex('123-456', 'ssnitNumber'),
    });
  });

  it('rejects nested Employee writes that could bypass encryption', async () => {
    const extension = createEmployeePiiEncryptionExtension();
    const query = jest.fn();
    await expect(extension.query.$allModels.$allOperations({
      model: 'PayrollItem',
      operation: 'create',
      args: { data: { employee: { create: { name: 'Employee', bankAccount: '12345678' } } } },
      query,
    })).rejects.toThrow(/Nested Employee writes are disabled/);
    expect(query).not.toHaveBeenCalled();
  });

  it('validates that encryption and blind-index keys are configured separately', () => {
    expect(validateEmployeePiiEncryptionConfig()).toBe(true);
    delete process.env.DATA_ENCRYPTION_INDEX_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => validateEmployeePiiEncryptionConfig()).toThrow(/DATA_ENCRYPTION_INDEX_KEY/);
  });
});
