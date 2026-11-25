import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = {
  user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  twoFactorRecoveryCode: { count: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  passwordResetToken: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const tx = {
  user: { update: jest.fn(), updateMany: jest.fn() },
  twoFactorRecoveryCode: { findFirst: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  passwordResetToken: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
const bcryptCompare = jest.fn();

jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  default: (req, _res, next) => { req.userId = 'user-1'; next(); },
}));
jest.unstable_mockModule('../utils/authTokens.js', () => ({
  signAccessToken: jest.fn(),
  signRefreshToken: jest.fn(),
  verifyRefreshToken: jest.fn(),
  computeExpiryDate: jest.fn(),
}));
jest.unstable_mockModule('../config/cookies.js', () => ({
  REFRESH_COOKIE_NAME: 'refresh',
  getRefreshCookieOptions: jest.fn(),
  getClearCookieOptions: jest.fn(),
}));
jest.unstable_mockModule('../services/emailService.js', () => ({
  sendPasswordResetEmail: jest.fn(),
}));
jest.unstable_mockModule('bcrypt', () => ({ default: { hash: jest.fn(), compare: bcryptCompare } }));
jest.unstable_mockModule('express-rate-limit', () => ({
  rateLimit: () => (_req, _res, next) => next(),
}));

const { default: authRouter } = await import('../routes/auth.js');
const { encryptSensitiveValue, decryptSensitiveValue } = await import('../services/employeePiiEncryption.js');
const { generateTotpCode, generateTotpSecret } = await import('../services/twoFactorService.js');
const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  return app;
};
const activeUser = {
  id: 'user-1',
  email: 'admin@example.test',
  companyId: 'company-1',
  password: 'password-hash',
  status: 'ACTIVE',
  deletedAt: null,
  twoFactorEnabled: false,
  twoFactorSecretEncrypted: null,
};
const enabledUser = (secret) => ({
  ...activeUser,
  twoFactorEnabled: true,
  twoFactorSecretEncrypted: encryptSensitiveValue(secret),
});

describe('TOTP account security routes', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    bcryptCompare.mockReset();
    prisma.user.findUnique.mockReset();
    prisma.twoFactorRecoveryCode.count.mockReset();
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    tx.user.update.mockReset();
    tx.user.updateMany.mockReset();
    tx.twoFactorRecoveryCode.findFirst.mockReset();
    tx.twoFactorRecoveryCode.updateMany.mockReset();
    tx.twoFactorRecoveryCode.deleteMany.mockReset();
    tx.twoFactorRecoveryCode.createMany.mockReset();
    tx.auditLog.create.mockReset();
  });

  afterEach(() => jest.clearAllMocks());

  it('requires the current password and stores only an encrypted pending authenticator secret', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUser);
    bcryptCompare.mockResolvedValue(true);
    tx.user.update.mockImplementation(async ({ data }) => data);
    tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const response = await request(makeApp()).post('/2fa/enroll').send({ password: 'CurrentPassword!1' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(response.body.otpauthUrl).toContain('otpauth://totp/');
    const updateData = tx.user.update.mock.calls[0][0].data;
    expect(updateData.twoFactorSecretEncrypted).toMatch(/^enc:v1:/);
    expect(updateData.twoFactorSecretEncrypted).not.toBe(response.body.secret);
    expect(decryptSensitiveValue(updateData.twoFactorSecretEncrypted)).toBe(response.body.secret);
    expect(updateData.twoFactorEnabled).toBe(false);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'TWO_FACTOR_ENROLLMENT_STARTED' }),
    }));
  });

  it('enables TOTP only after a valid code and returns hashed recovery codes once', async () => {
    const secret = generateTotpSecret();
    const pendingUser = { ...activeUser, twoFactorSecretEncrypted: encryptSensitiveValue(secret) };
    prisma.user.findUnique.mockResolvedValue(pendingUser);
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.twoFactorRecoveryCode.deleteMany.mockResolvedValue({ count: 0 });
    tx.twoFactorRecoveryCode.createMany.mockResolvedValue({ count: 10 });
    tx.auditLog.create.mockResolvedValue({ id: 'audit-2' });

    const response = await request(makeApp()).post('/2fa/verify-enrollment').send({ code: generateTotpCode(secret) });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.enabled).toBe(true);
    expect(response.body.recoveryCodes).toHaveLength(10);
    const savedCodes = tx.twoFactorRecoveryCode.createMany.mock.calls[0][0].data;
    expect(savedCodes).toHaveLength(10);
    expect(savedCodes.every((record) => /^[a-f0-9]{64}$/.test(record.codeHash))).toBe(true);
    expect(savedCodes.some((record) => response.body.recoveryCodes.includes(record.codeHash))).toBe(false);
    expect(tx.user.updateMany.mock.calls[0][0].data.twoFactorLastCounter).toEqual(expect.anything());
  });

  it('disables TOTP only after password and second-factor verification', async () => {
    const secret = generateTotpSecret();
    prisma.user.findUnique.mockResolvedValue(enabledUser(secret));
    bcryptCompare.mockResolvedValue(true);
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.user.update.mockResolvedValue({ id: 'user-1' });
    tx.twoFactorRecoveryCode.deleteMany.mockResolvedValue({ count: 10 });
    tx.auditLog.create.mockResolvedValue({ id: 'audit-3' });

    const response = await request(makeApp()).post('/2fa/disable').send({
      password: 'CurrentPassword!1',
      code: generateTotpCode(secret),
    });
    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);
    expect(tx.user.update.mock.calls[0][0].data).toMatchObject({
      twoFactorEnabled: false,
      twoFactorSecretEncrypted: null,
      twoFactorVerifiedAt: null,
      twoFactorLastCounter: null,
    });
    expect(tx.twoFactorRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'TWO_FACTOR_DISABLED' }),
    }));
  });

  it('shows recovery-code count without exposing secrets', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', twoFactorEnabled: true, twoFactorVerifiedAt: new Date() });
    prisma.twoFactorRecoveryCode.count.mockResolvedValue(7);
    const response = await request(makeApp()).get('/2fa/status');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ enabled: true, recoveryCodesRemaining: 7 });
    expect(response.body).not.toHaveProperty('secret');
    expect(response.body).not.toHaveProperty('twoFactorSecretEncrypted');
  });
});
