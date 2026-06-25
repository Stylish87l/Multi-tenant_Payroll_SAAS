// backend/routes/auth.js
import express from 'express';
import crypto from 'crypto';
import prisma from '../config/db.js';
import logger from '../config/logger.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  computeExpiryDate,
} from '../utils/authTokens.js';

const router = express.Router();

// ====================== COOKIE OPTIONS ======================
// IMPORTANT: this path MUST exactly match what Mutation.login sets in
// graphql/resolvers.js ('/api/auth/refresh'). A mismatched path makes the
// browser treat them as two different cookies - you'll end up with stale,
// unkillable cookies and logout() won't actually clear the real one.
const REFRESH_COOKIE_PATH = '/api/auth/refresh';

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: REFRESH_COOKIE_PATH,
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

// Increased to 60s to account for network latency and parallel requests
const GRACE_PERIOD_MS = 60 * 1000;

// ====================== PROTECTED ROUTES ======================
router.get('/me', (req, res) => {
  res.json({
    user: req.user,
    companyId: req.companyId,
    role: req.userRole,
  });
});

// ====================== REFRESH TOKEN ENDPOINT ======================
router.post('/refresh', async (req, res) => {
  const rawRefresh = req.cookies?.refreshToken;

  if (!rawRefresh) {
    return res.status(401).json({ error: 'Refresh token missing' });
  }

  try {
    const payload = verifyRefreshToken(rawRefresh);

    // Defensive guard: reject any token signed without a tokenId (e.g. one
    // issued before this fix shipped) instead of letting
    // findUnique({ where: { tokenId: undefined } }) misbehave.
    if (!payload?.tokenId) {
      logger.warn('Refresh token missing tokenId claim - rejecting', {
        userId: payload?.userId,
      });
      res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const record = await prisma.refreshToken.findUnique({
      where: { tokenId: payload.tokenId },
      include: { user: true },
    });

    if (!record) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (record.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // --- ENHANCED GRACE PERIOD LOGIC ---
    if (record.revokedAt) {
      const timeSinceRevocation = new Date().getTime() - new Date(record.revokedAt).getTime();

      // If rotated within the last 60 seconds, it's a race condition, not a hack
      if (record.revocationReason === 'rotated' && timeSinceRevocation < GRACE_PERIOD_MS) {
        // Fetch the most recent active token to bridge the gap
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

          // CRITICAL FIX: re-issue the cookie so the client is bridged onto
          // the *current* active token. Previously this branch handed back
          // a valid access token but left the browser holding the
          // now-revoked refresh cookie - the moment GRACE_PERIOD_MS elapsed,
          // every subsequent refresh hit the dead-end below and force-logged
          // the user out. This is exactly what made the lockout feel
          // intermittent/racy rather than immediate.
          const newRawRefresh = signRefreshToken({
            userId: user.id,
            tokenId: currentActiveToken.tokenId,
          });
          res.cookie('refreshToken', newRawRefresh, getCookieOptions());

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

    // CRITICAL FIX: the rotated refresh JWT must carry the SAME tokenId that
    // was just persisted to the DB below. The previous version signed this
    // token with only { userId }, so every future lookup by tokenId failed
    // and the session was unrecoverable after the very first rotation.
    const newRawRefresh = signRefreshToken({ userId: user.id, tokenId: newTokenId });

    // Use a transaction to ensure atomicity
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
          deviceInfo: req.get('User-Agent') || null,
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

    res.cookie('refreshToken', newRawRefresh, getCookieOptions());

    return res.json({
      accessToken: newAccessToken,
      companyId: user.companyId,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    logger.error('❌ [REFRESH] Error:', err.message);
    // Only clear if it's a structural error, not a race condition
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// ====================== LOGOUT ======================
router.post('/logout', async (req, res) => {
  const rawRefresh = req.cookies?.refreshToken;

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

  res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
  res.json({ message: 'Logged out successfully' });
});

export default router;