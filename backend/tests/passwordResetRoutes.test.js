import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';

const prisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  passwordResetToken: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const tx = {
  user: { update: jest.fn() },
  passwordResetToken: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
const sendPasswordResetEmail = jest.fn();
const bcryptHash = jest.fn();

jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../middleware/auth.js', () => ({ default: (_req, _res, next) => next() }));
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
  sendPasswordResetEmail,
}));
jest.unstable_mockModule('bcrypt', () => ({ default: { hash: bcryptHash } }));
jest.unstable_mockModule('express-rate-limit', () => ({
  rateLimit: () => (_req, _res, next) => next(),
}));

const { default: authRouter } = await import('../routes/auth.js');
const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  return app;
};
const activeUser = {
  id: 'user-1',
  email: 'person@example.test',
  name: 'Test User',
  status: 'ACTIVE',
  deletedAt: null,
  companyId: 'company-1',
};
const validTokenRecord = {
  id: 'reset-1',
  userId: activeUser.id,
  tokenHash: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 60_000),
  usedAt: null,
  user: { id: activeUser.id, companyId: activeUser.companyId, status: 'ACTIVE', deletedAt: null },
};

describe('password reset routes', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://usepaylio.vercel.app';
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    prisma.user.findUnique.mockReset();
    prisma.passwordResetToken.findFirst.mockReset();
    prisma.passwordResetToken.findUnique.mockReset();
    prisma.passwordResetToken.updateMany.mockReset();
    prisma.passwordResetToken.create.mockReset();
    tx.passwordResetToken.findUnique.mockReset();
    tx.passwordResetToken.updateMany.mockReset();
    tx.passwordResetToken.create.mockReset();
    tx.user.update.mockReset();
    tx.refreshToken.updateMany.mockReset();
    tx.auditLog.create.mockReset();
    sendPasswordResetEmail.mockReset();
    bcryptHash.mockReset();
  });

  afterEach(() => jest.clearAllMocks());

  it('returns the same generic response for unknown email addresses', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const response = await request(makeApp()).post('/forgot-password').send({ email: 'unknown@example.test' });
    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/If an active account exists/);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('stores only a token hash and sends a fragment-based reset link for active users', async () => {
    prisma.user.findUnique.mockResolvedValue(activeUser);
    prisma.passwordResetToken.findFirst.mockResolvedValue(null);
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    tx.passwordResetToken.create.mockResolvedValue({ id: 'reset-1' });
    sendPasswordResetEmail.mockResolvedValue({ messageId: 'mail-1' });

    const response = await request(makeApp()).post('/forgot-password').send({ email: ' PERSON@example.test ' });
    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/If an active account exists/);

    const [to, name, resetLink] = sendPasswordResetEmail.mock.calls[0];
    expect(to).toBe(activeUser.email);
    expect(name).toBe(activeUser.name);
    const url = new URL(resetLink);
    expect(url.pathname).toBe('/reset-password');
    const rawToken = new URLSearchParams(url.hash.slice(1)).get('token');
    expect(rawToken).toHaveLength(43);

    const createCall = tx.passwordResetToken.create.mock.calls[0][0];
    expect(createCall.data.tokenHash).toBe(crypto.createHash('sha256').update(rawToken).digest('hex'));
    expect(createCall.data).not.toHaveProperty('token');
    expect(createCall.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('consumes a reset token once, updates the password, revokes refresh sessions and audits completion', async () => {
    const rawToken = 'R'.repeat(43);
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const candidate = { ...validTokenRecord, tokenHash };
    prisma.passwordResetToken.findUnique.mockResolvedValue(candidate);
    tx.passwordResetToken.findUnique.mockResolvedValue(candidate);
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    tx.user.update.mockResolvedValue({ id: activeUser.id });
    tx.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    bcryptHash.mockResolvedValue('new-password-hash');

    const response = await request(makeApp()).post('/reset-password').send({
      token: rawToken,
      password: 'NewPassword!1',
    });
    expect(response.status).toBe(200);
    expect(bcryptHash).toHaveBeenCalledWith('NewPassword!1', 12);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: activeUser.id },
      data: { password: 'new-password-hash' },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: activeUser.id, revokedAt: null },
      data: expect.objectContaining({ revocationReason: 'password_reset' }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PASSWORD_RESET_COMPLETED', resourceId: activeUser.id }),
    }));
  });

  it('rejects expired, used or concurrently consumed tokens without changing the password', async () => {
    const rawToken = 'X'.repeat(43);
    prisma.passwordResetToken.findUnique.mockResolvedValue({ ...validTokenRecord, usedAt: new Date() });
    const replay = await request(makeApp()).post('/reset-password').send({
      token: rawToken,
      password: 'NewPassword!1',
    });
    expect(replay.status).toBe(400);
    expect(tx.user.update).not.toHaveBeenCalled();

    const candidate = { ...validTokenRecord, tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex') };
    prisma.passwordResetToken.findUnique.mockResolvedValue(candidate);
    tx.passwordResetToken.findUnique.mockResolvedValue(candidate);
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    bcryptHash.mockResolvedValue('new-password-hash');

    const raced = await request(makeApp()).post('/reset-password').send({
      token: rawToken,
      password: 'NewPassword!1',
    });
    expect(raced.status).toBe(400);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
