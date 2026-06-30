// backend/routes/auth.js
import express from 'express';
import crypto from 'crypto';
import prisma from '../config/db.js';
import logger from '../config/logger.js';
import authMiddleware from '../middleware/auth.js'; // FIXED: Imported for route protection
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  computeExpiryDate,
} from '../utils/authTokens.js';
import {
  REFRESH_COOKIE_NAME,
  getRefreshCookieOptions,
  getClearCookieOptions,
} from '../config/cookies.js';

const router = express.Router();

// Increased to 60s to account for network latency and parallel requests
const GRACE_PERIOD_MS = 60 * 1000;

// ====================== PROTECTED ROUTES ======================
// FIXED: Applied authMiddleware to prevent returning undefined fields to client
router.get('/me', authMiddleware, (req, res) => {
  res.json({
    user: req.user,
    companyId: req.companyId,
    role: req.userRole,
  });
});

// ====================== REFRESH TOKEN ENDPOINT ======================
router.post('/refresh', async (req, res) => {
  const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];

  if (!rawRefresh) {
    logger.warn('Refresh attempt blocked: No refresh cookie present', {
      path: req.originalUrl,
      origin: req.headers.origin,
    });
    return res.status(401).json({ error: 'Refresh token missing' });
  }

  try {
    const payload = verifyRefreshToken(rawRefresh);

    // Defensive guard: reject any token signed without a tokenId claim
    if (!payload?.tokenId) {
      logger.warn('Refresh token missing tokenId claim - rejecting', {
        userId: payload?.userId,
      });
      res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const record = await prisma.refreshToken.findUnique({
      where: { tokenId: payload.tokenId },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // --- ENHANCED GRACE PERIOD LOGIC ---
    if (record.revokedAt) {
      const timeSinceRevocation = new Date().getTime() - new Date(record.revokedAt).getTime();

      if (record.revocationReason === 'rotated' && timeSinceRevocation < GRACE_PERIOD_MS) {
        const currentActiveToken = await prisma.refreshToken.findFirst({
          where: {
            userId: record.userId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
          include: { user: true },
        });

        if (currentActiveToken && currentActiveToken.user) {
          const user = currentActiveToken.user;
          const accessToken = signAccessToken({
            userId: user.id,
            companyId: user.role === 'SUPER_ADMIN' ? null : user.companyId,
            role: user.role,
            email: user.email,
          });

          const newRawRefresh = signRefreshToken({
            userId: user.id,
            tokenId: currentActiveToken.tokenId,
          });
          res.cookie(REFRESH_COOKIE_NAME, newRawRefresh, getRefreshCookieOptions());

          return res.json({
            accessToken,
            companyId: user.companyId,
            user: { id: user.id, email: user.email, name: user.name, role: user.role },
          });
        }
      }
      return res.status(401).json({ error: 'Session expired' });
    }

    // --- NORMAL ROTATION LOGIC ---
    const user = record.user;
    const newTokenId = crypto.randomUUID();
    const newRawRefresh = signRefreshToken({ userId: user.id, tokenId: newTokenId });

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: record.id },
        data: {
          revokedAt: new Date(),
          revocationReason: 'rotated',
        },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenId: newTokenId,
          expiresAt: computeExpiryDate(),
          deviceInfo: req.get?.('User-Agent') || null,
          ipAddress: req.ip || null,
        },
      }),
    ]);

    const newAccessToken = signAccessToken({
      userId: user.id,
      companyId: user.role === 'SUPER_ADMIN' ? null : user.companyId,
      role: user.role,
      email: user.email,
    });

    res.cookie(REFRESH_COOKIE_NAME, newRawRefresh, getRefreshCookieOptions());

    return res.json({
      accessToken: newAccessToken,
      companyId: user.companyId,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    logger.error('Refresh token verification failed', {
      message: err.message,
      path: req.originalUrl,
    });
    res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions());
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// ====================== LOGOUT ======================
router.post('/logout', async (req, res) => {
  const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];

  if (rawRefresh) {
    try {
      const payload = verifyRefreshToken(rawRefresh);
      if (payload?.tokenId) {
        await prisma.refreshToken.updateMany({
          where: { tokenId: payload.tokenId, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revocationReason: 'logout',
          },
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