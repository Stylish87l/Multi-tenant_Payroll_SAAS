import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createEmployeePiiBlindIndex,
  createEmployeePiiEncryptionExtension,
  decryptSensitiveValue,
  encryptEmployeeWriteData,
  encryptSensitiveValue,
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

  it('uses a fresh nonce for each encryption and is idempotent for existing envelopes', () => {
    const first = encryptSensitiveValue('GHA-123456789-0');
    const second = encryptSensitiveValue('GHA-123456789-0');
    expect(first).not.toBe(second);
    expect(encryptSensitiveValue(first)).toBe(first);
  });

  it('supports decrypting old encryption keys during key rotation', () => {
    process.env.DATA_ENCRYPTION_KEY_ID = 'old-key';
    const oldCiphertext = encryptSensitiveValue('old-value');
    process.env.DATA_ENCRYPTION_KEY_ID = 'new-key';
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 0x77).toString('base64');
    process.env.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ 'old-key': key });
    expect(decryptSensitiveValue(oldCiphertext)).toBe('old-value');
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

  it('encrypts all sensitive employee write fields and removes plaintext keys', () => {
    const data = encryptEmployeeWriteData({
      name: 'Employee',
      bankAccount: '0012345678',
      ssnitNumber: 'SSNIT-123456',
      ghanaCardPin: 'GHA-123456789-0',
    });
    expect(data).toHaveProperty('name', 'Employee');
    expect(data).not.toHaveProperty('bankAccount');
    expect(data).not.toHaveProperty('ssnitNumber');
    expect(data).not.toHaveProperty('ghanaCardPin');
    expect(decryptSensitiveValue(data.bankAccountEncrypted)).toBe('0012345678');
    expect(decryptSensitiveValue(data.ssnitNumberEncrypted)).toBe('SSNIT-123456');
    expect(decryptSensitiveValue(data.ghanaCardPinEncrypted)).toBe('GHA-123456789-0');
    expect(data.ssnitNumberHash).toMatch(/^hmac:v1:/);
    expect(data.ghanaCardPinHash).toMatch(/^hmac:v1:/);
  });

  it('clears encrypted values and blind indexes when a field is explicitly cleared', () => {
    expect(encryptEmployeeWriteData({
      bankAccount: null, ssnitNumber: null, ghanaCardPin: null,
    })).toMatchObject({
      bankAccountEncrypted: null,
      ssnitNumberEncrypted: null,
      ssnitNumberHash: null,
      ghanaCardPinEncrypted: null,
      ghanaCardPinHash: null,
    });
  });

  it('applies encryption to direct Employee writes and decrypts nested Employee results', async () => {
    const extension = createEmployeePiiEncryptionExtension();
    const query = jest.fn(async (args) => args);
    const args = { data: { bankAccount: '12345678', ssnitNumber: '123-456' } };
    await extension.query.employee.$allOperations({ operation: 'create', args, query });
    const stored = query.mock.calls[0][0].data;
    expect(stored).not.toHaveProperty('bankAccount');
    expect(decryptSensitiveValue(stored.bankAccountEncrypted)).toBe('12345678');
    expect(decryptSensitiveValue(stored.ssnitNumberEncrypted)).toBe('123-456');

    const account = extension.result.employee.bankAccount.compute({ bankAccountEncrypted: stored.bankAccountEncrypted });
    const ssnit = extension.result.employee.ssnitNumber.compute({ ssnitNumberEncrypted: stored.ssnitNumberEncrypted });
    expect(account).toBe('12345678');
    expect(ssnit).toBe('123-456');
  });

  it('rewrites exact SSNIT and Ghana Card filters to blind indexes', async () => {
    const extension = createEmployeePiiEncryptionExtension();
    const query = jest.fn(async (args) => args);
    const args = { where: { OR: [{ ssnitNumber: '123-456' }, { ghanaCardPin: { equals: 'GHA-123' } }] } };
    await extension.query.employee.$allOperations({ operation: 'findMany', args, query });
    const where = query.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ ssnitNumberHash: createEmployeePiiBlindIndex('123-456', 'ssnitNumber') });
    expect(where.OR[1]).toEqual({ ghanaCardPinHash: { equals: createEmployeePiiBlindIndex('GHA-123', 'ghanaCardPin') } });
  });

  it('validates that both encryption and blind-index keys are configured', () => {
    expect(validateEmployeePiiEncryptionConfig()).toBe(true);
    delete process.env.DATA_ENCRYPTION_INDEX_KEY;
    expect(() => validateEmployeePiiEncryptionConfig()).toThrow(/DATA_ENCRYPTION_INDEX_KEY/);
  });
});
