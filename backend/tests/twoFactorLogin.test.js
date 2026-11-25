import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { clearFailures } from '../utils/loginThrottle.js';

const prisma = {
  user: { findUnique: jest.fn() },
  refreshToken: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const tx = { auditLog: { create: jest.fn() } };
const bcryptCompare = jest.fn();
const verifyUserTwoFactorCode = jest.fn();

jest.unstable_mockModule('../config/db.js', () => ({
  default: prisma,
  Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' } },
}));
jest.unstable_mockModule('bcrypt', () => ({ default: { compare: bcryptCompare } }));
jest.unstable_mockModule('../utils/authTokens.js', () => ({
  signAccessToken: jest.fn(),
  signRefreshToken: jest.fn(),
  computeExpiryDate: jest.fn(),
}));
jest.unstable_mockModule('../config/cookies.js', () => ({
  REFRESH_COOKIE_NAME: 'refresh',
  getRefreshCookieOptions: jest.fn(),
}));
jest.unstable_mockModule('../services/twoFactorService.js', () => ({ verifyUserTwoFactorCode }));

const { default: resolvers } = await import('../graphql/resolvers.js');
const login = resolvers.Mutation.login;
const user = {
  id: 'user-1',
  email: 'two-factor-login@example.test',
  password: 'password-hash',
  status: 'ACTIVE',
  deletedAt: null,
  companyId: 'company-1',
  role: 'ADMIN',
  twoFactorEnabled: true,
  twoFactorSecretEncrypted: 'enc:v1:test-key:placeholder',
};
const context = { req: { ip: '127.0.0.1', get: () => 'test-agent' } };

describe('GraphQL login second-factor enforcement', () => {
  beforeEach(() => {
    clearFailures(user.email);
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    bcryptCompare.mockResolvedValue(true);
    verifyUserTwoFactorCode.mockReset();
    prisma.refreshToken.create.mockReset();
    tx.auditLog.create.mockReset();
  });

  afterEach(() => {
    clearFailures(user.email);
    jest.clearAllMocks();
  });

  it('does not issue a session after password verification when a second factor is required', async () => {
    await expect(login(null, { email: user.email, password: 'correct-password' }, context))
      .rejects.toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid second factor and does not issue a session', async () => {
    verifyUserTwoFactorCode.mockResolvedValue({ valid: false, method: null });
    await expect(login(null, {
      email: user.email,
      password: 'correct-password',
      twoFactorCode: '000000',
    }, context)).rejects.toMatchObject({ code: 'INVALID_TWO_FACTOR_CODE' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});
