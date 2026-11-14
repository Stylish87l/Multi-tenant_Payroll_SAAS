import express from 'express';
import crypto from 'crypto';
import prisma from '../config/db.js';
import logger from '../config/logger.js';
import authMiddleware from '../middleware/auth.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, computeExpiryDate } from '../utils/authTokens.js';
import { REFRESH_COOKIE_NAME, getRefreshCookieOptions, getClearCookieOptions } from '../config/cookies.js';

const router = express.Router();

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

// CSRF defence for endpoints authenticated by the httpOnly refresh cookie.
// The custom header cannot be attached by a cross-origin HTML form; browsers require
// a CORS preflight for cross-origin fetches, and only trusted origins are allow-listed.
const csrfProtection = (req, res, next) => {
  if (req.get('x-csrf-protection') !== '1') {
    logger.warn('Blocked cookie-auth request without CSRF header', { path: req.path, ip: req.ip });
    return res.status(403).json({ error: 'CSRF protection header required' });
  }

  const fetchSite = req.get('Sec-Fetch-Site');
  if (fetchSite === 'cross-site') {
    logger.warn('Blocked cross-site cookie-auth request', { path: req.path, ip: req.ip });
    return res.status(403).json({ error: 'Cross-site request blocked' });
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

    // Normal rotation
    const newTokenId = crypto.randomUUID();
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date(), revocationReason: 'rotated', lastUsedAt: new Date() },
      }),
      prisma.refreshToken.create({
        data: {
          userId: record.userId,
          tokenId: newTokenId,
          expiresAt: computeExpiryDate(),
          deviceInfo: req.get('User-Agent') || null,
          ipAddress: req.ip || null,
        },
      }),
    ]);

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

export default router;
