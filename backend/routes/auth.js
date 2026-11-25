import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import prisma from '../config/db.js';
import logger from '../config/logger.js';
import authMiddleware from '../middleware/auth.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, computeExpiryDate } from '../utils/authTokens.js';
import { REFRESH_COOKIE_NAME, getRefreshCookieOptions, getClearCookieOptions } from '../config/cookies.js';
import { passwordSchema } from '../schemas/authSchema.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
import { decryptSensitiveValue, encryptSensitiveValue } from '../services/employeePiiEncryption.js';
import {
  createOtpAuthUri, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode,
  verifyTotp, verifyUserTwoFactorCode,
} from '../services/twoFactorService.js';

const router = express.Router();
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Please try again later.' },
});
const passwordResetEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
}).strict();
const passwordResetCompleteSchema = z.object({
  token: z.string().min(32).max(200),
  password: passwordSchema,
}).strict();
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_GENERIC_MESSAGE = 'If an active account exists for that email, a password reset link will be sent.';
const INVALID_RESET_MESSAGE = 'This password reset link is invalid or has expired. Request a new link and try again.';
const hashPasswordResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many two-factor attempts. Please try again later.' },
});
const twoFactorEnrollmentSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const twoFactorCodeSchema = z.object({ code: z.string().trim().min(6).max(40) }).strict();
const twoFactorDisableSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(40),
}).strict();

const writeTwoFactorAudit = (tx, user, req, action, details = {}) => tx.auditLog.create({
  data: {
    userId: user.id,
    companyId: user.companyId,
    action,
    details,
    ipAddress: req.ip || null,
    userAgent: req.get('User-Agent') || null,
    resourceType: 'User',
    resourceId: user.id,
    performedBy: 'user',
  },
});



// 60s grace for parallel requests racing a rotation (multiple tabs, Apollo retries).
const GRACE_PERIOD_MS = 60 * 1000;

const USER_SELECT = {
  id: true, email: true, name: true, role: true, status: true, companyId: true, deletedAt: true,
  company: { select: { name: true } },
};

const buildAuthResponse = (user, accessToken) => ({
  accessToken,
  companyId: user.companyId,
  user: { id: user.id, email: user.email, name: user.name, role: user.role, companyId: user.companyId, companyName: user.company?.name ?? null },
});

const signAccessFor = (user) =>
  signAccessToken({
    userId: user.id,
    companyId: user.role === 'SUPER_ADMIN' ? null : user.companyId,
    role: user.role,
    email: user.email,
  });

const isUserUsable = (user) => user && user.status === 'ACTIVE' && !user.deletedAt;

// Signed double-submit CSRF token. The random value is stored in an httpOnly cookie;
// the same value is returned to the trusted SPA and must be echoed in x-csrf-token.
// HMAC signing prevents an attacker from planting a forged cookie on a shared domain.
const CSRF_COOKIE_NAME = 'csrf';
const CSRF_TTL_MS = 2 * 60 * 60 * 1000;
const csrfSecret = () => {
  if (!process.env.CSRF_SECRET) {
    throw new Error('CSRF_SECRET must be configured before issuing or validating CSRF tokens.');
  }
  return process.env.CSRF_SECRET;
};
const signCsrfValue = (value) => crypto.createHmac('sha256', csrfSecret()).update(value).digest('hex');
const createCsrfToken = () => {
  const value = `${Date.now()}.${crypto.randomBytes(32).toString('hex')}`;
  return `${value}.${signCsrfValue(value)}`;
};
const isValidCsrfToken = (token) => {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issuedAt, nonce, signature] = parts;
  if (!/^\d{13}$/.test(issuedAt) || !/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const age = Date.now() - Number(issuedAt);
  if (age < 0 || age > CSRF_TTL_MS) return false;
  const expected = signCsrfValue(`${issuedAt}.${nonce}`);
  const actualBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};
const csrfCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/api/auth',
  maxAge: CSRF_TTL_MS,
});
const csrfProtection = (req, res, next) => {
  const cookieToken = req.cookies?.csrf;
  const headerToken = req.get('x-csrf-token');
  const tokenMatches = typeof cookieToken === 'string'
    && typeof headerToken === 'string'
    && cookieToken.length === headerToken.length
    && crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));

  if (!tokenMatches || !isValidCsrfToken(cookieToken)) {
    logger.warn('Blocked cookie-auth request with invalid CSRF token', { path: req.path, ip: req.ip });
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  if (process.env.NODE_ENV === 'production') {
    const origin = req.get('Origin');
    const allowed = new Set([
      process.env.FRONTEND_URL,
      ...(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()),
    ].filter(Boolean));
    if (!origin || !allowed.has(origin)) {
      logger.warn('Blocked cookie-auth request from untrusted origin', { origin: origin || null, path: req.path, ip: req.ip });
      return res.status(403).json({ error: 'Untrusted request origin' });
    }
  }
  return next();
};

// Safe bootstrap endpoint: issue a token once, then reuse the valid cookie token
// so parallel tabs do not invalidate each other's in-flight refresh/logout requests.
router.get('/csrf-token', (req, res) => {
  let token = req.cookies?.csrf;
  if (!isValidCsrfToken(token)) {
    token = createCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  }
  res.set('Cache-Control', 'no-store');
  return res.json({ csrfToken: token });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user, companyId: req.companyId, role: req.userRole });
});

router.post('/refresh', csrfProtection, async (req, res) => {
  const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!rawRefresh) {
    logger.warn('Refresh attempt blocked: No refresh cookie present', { origin: req.headers.origin });
    return res.status(401).json({ error: 'Refresh token missing' });
  }

  try {
    const payload = verifyRefreshToken(rawRefresh);

    if (!payload?.tokenId) {
      logger.warn('Refresh token missing tokenId claim - rejecting', { userId: payload?.userId });
      res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const record = await prisma.refreshToken.findUnique({
      where: { tokenId: payload.tokenId },
      include: { user: { select: USER_SELECT } },
    });

    if (!record || record.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // FIXED: suspended / soft-deleted users could previously keep refreshing forever.
    if (!isUserUsable(record.user)) {
      await prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'account_inactive' },
      });
      res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
      return res.status(401).json({ error: 'Session expired' });
    }

    if (record.revokedAt) {
      const sinceRevocation = Date.now() - new Date(record.revokedAt).getTime();

      if (record.revocationReason === 'rotated' && sinceRevocation < GRACE_PERIOD_MS) {
        // Legit parallel request: hand back the current active session instead of failing.
        const current = await prisma.refreshToken.findFirst({
          where: { userId: record.userId, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        });
        if (current) {
          res.cookie(REFRESH_COOKIE_NAME, signRefreshToken({ userId: record.userId, tokenId: current.tokenId }), getRefreshCookieOptions());
          return res.json(buildAuthResponse(record.user, signAccessFor(record.user)));
        }
      } else if (record.revocationReason === 'rotated') {
        // A rotated token replayed AFTER the grace window = likely stolen. Kill the whole session family.
        logger.warn('SECURITY: refresh token reuse detected - revoking all sessions', { userId: record.userId, ip: req.ip });
        await prisma.refreshToken.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'reuse_detected' },
        });
      }
      res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
      return res.status(401).json({ error: 'Session expired' });
    }

    // Claim rotation conditionally: only one concurrent request may rotate this token.
    const newTokenId = crypto.randomUUID();
    const rotation = await prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'rotated', lastUsedAt: new Date() },
      });
      if (claimed.count !== 1) return { rotated: false };

      await tx.refreshToken.create({
        data: {
          userId: record.userId,
          tokenId: newTokenId,
          expiresAt: computeExpiryDate(),
          deviceInfo: req.get('User-Agent') || null,
          ipAddress: req.ip || null,
        },
      });
      return { rotated: true };
    });

    if (!rotation.rotated) {
      // Another request won the rotation race after our initial read.
      const latest = await prisma.refreshToken.findUnique({ where: { id: record.id } });
      const age = latest?.revokedAt ? Date.now() - new Date(latest.revokedAt).getTime() : Infinity;
      if (latest?.revocationReason === 'rotated' && age >= 0 && age < GRACE_PERIOD_MS) {
        const current = await prisma.refreshToken.findFirst({
          where: { userId: record.userId, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
        });
        if (current) {
          res.cookie(REFRESH_COOKIE_NAME, signRefreshToken({ userId: record.userId, tokenId: current.tokenId }), getRefreshCookieOptions());
          return res.json(buildAuthResponse(record.user, signAccessFor(record.user)));
        }
      }
      res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
      return res.status(401).json({ error: 'Session expired' });
    }

    res.cookie(REFRESH_COOKIE_NAME, signRefreshToken({ userId: record.userId, tokenId: newTokenId }), getRefreshCookieOptions());
    return res.json(buildAuthResponse(record.user, signAccessFor(record.user)));
  } catch (err) {
    logger.error('Refresh token verification failed', { message: err.message });
    res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

router.post('/logout', csrfProtection, async (req, res) => {
  const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
  if (rawRefresh) {
    try {
      const payload = verifyRefreshToken(rawRefresh);
      if (payload?.tokenId) {
        await prisma.refreshToken.updateMany({
          where: { tokenId: payload.tokenId, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'logout' },
        });
      }
    } catch (e) {
      logger.warn('Logout: Failed to revoke token', { message: e.message });
    }
  }
  res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
  res.json({ message: 'Logged out successfully' });
});


/**
 * Password reset request is deliberately enumeration-safe: every syntactically
 * valid or invalid email receives the same response. Only the SHA-256 token hash
 * is persisted; the bearer token is delivered once by email and never logged.
 */
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const parsed = passwordResetEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(200).json({ message: PASSWORD_RESET_GENERIC_MESSAGE });

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, name: true, status: true, deletedAt: true },
  });
  if (!user || user.status !== 'ACTIVE' || user.deletedAt || !process.env.FRONTEND_URL) {
    if (!process.env.FRONTEND_URL) logger.error('Password reset unavailable: FRONTEND_URL is not configured.');
    return res.status(200).json({ message: PASSWORD_RESET_GENERIC_MESSAGE });
  }

  try {
    const recentRequest = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        createdAt: { gt: new Date(Date.now() - 60 * 1000) },
      },
      select: { id: true },
    });
    if (recentRequest) return res.status(200).json({ message: PASSWORD_RESET_GENERIC_MESSAGE });

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashPasswordResetToken(rawToken);
    const now = new Date();
    const resetUrl = new URL('/reset-password', process.env.FRONTEND_URL);
    resetUrl.hash = new URLSearchParams({ token: rawToken }).toString();

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS) },
      });
    });

    try {
      const delivery = await sendPasswordResetEmail(user.email, user.name, resetUrl.toString());
      if (delivery?.skipped) {
        await prisma.passwordResetToken.updateMany({ where: { tokenHash, usedAt: null }, data: { usedAt: new Date() } });
      }
    } catch (error) {
      await prisma.passwordResetToken.updateMany({ where: { tokenHash, usedAt: null }, data: { usedAt: new Date() } });
      logger.error('Password reset email delivery failed', { userId: user.id, message: error.message });
    }
  } catch (error) {
    logger.error('Password reset request failed', { userId: user.id, message: error.message });
  }

  return res.status(200).json({ message: PASSWORD_RESET_GENERIC_MESSAGE });
});

router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const parsed = passwordResetCompleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: INVALID_RESET_MESSAGE });

  const tokenHash = hashPasswordResetToken(parsed.data.token);
  const now = new Date();
  const candidate = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, companyId: true, status: true, deletedAt: true } } },
  });
  if (!candidate || candidate.usedAt || candidate.expiresAt <= now
    || candidate.user.status !== 'ACTIVE' || candidate.user.deletedAt) {
    return res.status(400).json({ error: INVALID_RESET_MESSAGE });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    await prisma.$transaction(async (tx) => {
      const consumedAt = new Date();
      const current = await tx.passwordResetToken.findUnique({
        where: { id: candidate.id },
        include: { user: { select: { id: true, companyId: true, status: true, deletedAt: true } } },
      });
      if (!current || current.usedAt || current.expiresAt <= consumedAt
        || current.user.status !== 'ACTIVE' || current.user.deletedAt) {
        throw new Error('RESET_TOKEN_INVALID');
      }

      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: current.id, usedAt: null, expiresAt: { gt: consumedAt } },
        data: { usedAt: consumedAt },
      });
      if (consumed.count !== 1) throw new Error('RESET_TOKEN_INVALID');

      await tx.user.update({ where: { id: current.userId }, data: { password: passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId: current.userId, revokedAt: null },
        data: { revokedAt: consumedAt, revocationReason: 'password_reset' },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: current.userId, usedAt: null },
        data: { usedAt: consumedAt },
      });
      await tx.auditLog.create({
        data: {
          userId: current.userId,
          companyId: current.user.companyId,
          action: 'PASSWORD_RESET_COMPLETED',
          details: { method: 'email' },
          ipAddress: req.ip || null,
          userAgent: req.get('User-Agent') || null,
          resourceType: 'User',
          resourceId: current.userId,
          performedBy: 'system',
        },
      });
    });
    return res.status(200).json({ message: 'Password reset successfully. Please sign in again.' });
  } catch (error) {
    if (error.message === 'RESET_TOKEN_INVALID') return res.status(400).json({ error: INVALID_RESET_MESSAGE });
    logger.error('Password reset completion failed', { message: error.message });
    return res.status(500).json({ error: 'Unable to reset password right now. Please try again.' });
  }
});


router.get('/2fa/status', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, twoFactorEnabled: true, twoFactorVerifiedAt: true },
    });
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    const recoveryCodesRemaining = user.twoFactorEnabled
      ? await prisma.twoFactorRecoveryCode.count({ where: { userId: user.id, usedAt: null } })
      : 0;
    return res.json({
      enabled: user.twoFactorEnabled,
      verifiedAt: user.twoFactorVerifiedAt,
      recoveryCodesRemaining,
    });
  } catch (error) { return next(error); }
});

router.post('/2fa/enroll', authMiddleware, twoFactorLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const parsed = twoFactorEnrollmentSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Your current password is required to start two-factor setup.' });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, password: true, companyId: true, status: true, deletedAt: true, twoFactorEnabled: true },
    });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') return res.status(404).json({ error: 'Active account not found.' });
    if (user.twoFactorEnabled) return res.status(409).json({ error: 'Two-factor authentication is already enabled.' });
    if (!(await bcrypt.compare(parsed.data.password, user.password))) return res.status(401).json({ error: 'Current password is incorrect.' });

    const secret = generateTotpSecret();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecretEncrypted: encryptSensitiveValue(secret),
          twoFactorVerifiedAt: null,
        },
      });
      await writeTwoFactorAudit(tx, user, req, 'TWO_FACTOR_ENROLLMENT_STARTED', { method: 'totp' });
    });
    return res.json({ secret, otpauthUrl: createOtpAuthUri({ email: user.email, secret }) });
  } catch (error) { return next(error); }
});

router.post('/2fa/verify-enrollment', authMiddleware, twoFactorLimiter, async (req, res, next) => {
  try {
    const parsed = twoFactorCodeSchema.safeParse(req.body ?? {});
    if (!parsed.success || !/^\d{6}$/.test(parsed.data?.code || '')) {
      return res.status(400).json({ error: 'Enter the six-digit code from your authenticator app.' });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, companyId: true, status: true, deletedAt: true, twoFactorEnabled: true, twoFactorSecretEncrypted: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) return res.status(404).json({ error: 'Active account not found.' });
    if (!user.twoFactorSecretEncrypted) return res.status(409).json({ error: 'Start two-factor setup before verifying a code.' });
    if (user.twoFactorEnabled) return res.status(409).json({ error: 'Two-factor authentication is already enabled.' });
    const secret = decryptSensitiveValue(user.twoFactorSecretEncrypted);
    if (!verifyTotp(secret, parsed.data.code)) return res.status(400).json({ error: 'The authenticator code is invalid or expired.' });

    const recoveryCodes = generateRecoveryCodes();
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: user.id, twoFactorEnabled: false, twoFactorSecretEncrypted: user.twoFactorSecretEncrypted },
        data: { twoFactorEnabled: true, twoFactorVerifiedAt: now },
      });
      if (updated.count !== 1) throw new Error('TWO_FACTOR_ENROLLMENT_CHANGED');
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.twoFactorRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code) })),
      });
      await writeTwoFactorAudit(tx, user, req, 'TWO_FACTOR_ENABLED', { recoveryCodesIssued: recoveryCodes.length });
    });
    return res.json({
      enabled: true,
      recoveryCodes,
      message: 'Two-factor authentication is enabled. Save these recovery codes now; they will not be shown again.',
    });
  } catch (error) {
    if (error.message === 'TWO_FACTOR_ENROLLMENT_CHANGED') return res.status(409).json({ error: 'Two-factor setup changed. Start again.' });
    return next(error);
  }
});

router.post('/2fa/disable', authMiddleware, twoFactorLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const parsed = twoFactorDisableSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Current password and authenticator or recovery code are required.' });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, companyId: true, password: true, status: true, deletedAt: true, twoFactorEnabled: true, twoFactorSecretEncrypted: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) return res.status(404).json({ error: 'Active account not found.' });
    if (!user.twoFactorEnabled) return res.status(409).json({ error: 'Two-factor authentication is not enabled.' });
    if (!(await bcrypt.compare(parsed.data.password, user.password))) return res.status(401).json({ error: 'Current password is incorrect.' });

    await prisma.$transaction(async (tx) => {
      const verification = await verifyUserTwoFactorCode({ tx, user, code: parsed.data.code });
      if (!verification.valid) throw new Error('INVALID_TWO_FACTOR_CODE');
      await tx.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: false, twoFactorSecretEncrypted: null, twoFactorVerifiedAt: null },
      });
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
      await writeTwoFactorAudit(tx, user, req, 'TWO_FACTOR_DISABLED', { verificationMethod: verification.method });
    });
    return res.json({ enabled: false, message: 'Two-factor authentication has been disabled.' });
  } catch (error) {
    if (error.message === 'INVALID_TWO_FACTOR_CODE') return res.status(400).json({ error: 'The authenticator or recovery code is invalid or already used.' });
    return next(error);
  }
});

router.post('/2fa/recovery-codes/regenerate', authMiddleware, twoFactorLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const parsed = twoFactorCodeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Enter your authenticator or recovery code.' });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, companyId: true, status: true, deletedAt: true, twoFactorEnabled: true, twoFactorSecretEncrypted: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) return res.status(404).json({ error: 'Active account not found.' });
    if (!user.twoFactorEnabled) return res.status(409).json({ error: 'Enable two-factor authentication first.' });

    const recoveryCodes = generateRecoveryCodes();
    await prisma.$transaction(async (tx) => {
      const verification = await verifyUserTwoFactorCode({ tx, user, code: parsed.data.code });
      if (!verification.valid) throw new Error('INVALID_TWO_FACTOR_CODE');
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.twoFactorRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({ userId: user.id, codeHash: hashRecoveryCode(code) })),
      });
      await writeTwoFactorAudit(tx, user, req, 'TWO_FACTOR_RECOVERY_CODES_REGENERATED', { recoveryCodesIssued: recoveryCodes.length, verificationMethod: verification.method });
    });
    return res.json({
      recoveryCodes,
      message: 'New recovery codes generated. Previous recovery codes are no longer valid. Save these codes now.',
    });
  } catch (error) {
    if (error.message === 'INVALID_TWO_FACTOR_CODE') return res.status(400).json({ error: 'The authenticator or recovery code is invalid or already used.' });
    return next(error);
  }
});

export default router;
