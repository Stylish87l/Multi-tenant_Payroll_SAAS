import { describe, expect, it, jest } from '@jest/globals';
import {
  base32Decode,
  base32Encode,
  consumeRecoveryCode,
  createOtpAuthUri,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
  verifyUserTwoFactorCode,
} from '../services/twoFactorService.js';
import { encryptSensitiveValue } from '../services/employeePiiEncryption.js';

describe('TOTP and recovery-code service', () => {
  it('round-trips Base32 secrets and generates 160-bit TOTP secrets', () => {
    const bytes = Buffer.from('Paylio authenticator secret');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('verifies RFC 6238 SHA-1 six-digit test vector and rejects invalid codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(verifyTotp(secret, '287082', 59_000, 0)).toBe(true);
    expect(verifyTotp(secret, '287083', 59_000, 0)).toBe(false);
    expect(verifyTotp(secret, '287082', 59_000 + 120_000, 0)).toBe(false);
    expect(verifyTotp(secret, '12AB56', 59_000, 1)).toBe(false);
  });

  it('atomically consumes each TOTP time step so the same code cannot be replayed', async () => {
    const secret = generateTotpSecret();
    const user = {
      id: 'user-1',
      twoFactorEnabled: true,
      twoFactorSecretEncrypted: encryptSensitiveValue(secret),
    };
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      twoFactorRecoveryCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    const code = generateTotpCode(secret);
    expect(await verifyUserTwoFactorCode({ tx, user, code })).toEqual({ valid: true, method: 'totp' });
    expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: user.id, twoFactorEnabled: true }),
      data: { twoFactorLastCounter: expect.anything() },
    }));

    tx.user.updateMany.mockResolvedValue({ count: 0 });
    expect(await verifyUserTwoFactorCode({ tx, user, code })).toEqual({ valid: false, method: null });
  });

  it('creates an authenticator URI with issuer and account label', () => {
    const uri = createOtpAuthUri({ email: 'admin@example.test', secret: 'JBSWY3DPEHPK3PXP' });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Paylio');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('generates high-entropy recovery codes and hashes them independent of formatting', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(codes.every((code) => /^[A-F0-9]{4}(?:-[A-F0-9]{4}){5}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].replace(/-/g, '').toLowerCase()));
    expect(hashRecoveryCode('not-a-recovery-code')).toBeNull();
  });

  it('consumes a recovery code once using a conditional update', async () => {
    const tx = {
      twoFactorRecoveryCode: {
        findFirst: jest.fn().mockResolvedValue({ id: 'recovery-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const code = 'ABCD-EF01-2345-6789-ABCD-EF01';
    expect(await consumeRecoveryCode(tx, 'user-1', code)).toBe(true);
    expect(tx.twoFactorRecoveryCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'recovery-1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });

    tx.twoFactorRecoveryCode.updateMany.mockResolvedValue({ count: 0 });
    expect(await consumeRecoveryCode(tx, 'user-1', code)).toBe(false);
  });

  it('does not query the database for malformed recovery codes', async () => {
    const tx = { twoFactorRecoveryCode: { findFirst: jest.fn(), updateMany: jest.fn() } };
    expect(await consumeRecoveryCode(tx, 'user-1', '123456')).toBe(false);
    expect(tx.twoFactorRecoveryCode.findFirst).not.toHaveBeenCalled();
  });
});
