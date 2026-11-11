import { verifyAccessToken, extractBearerToken } from '../utils/authTokens.js';
import logger from '../config/logger.js';

const ANONYMOUS = { userId: null, companyId: null, userRole: null, user: null, isSuperAdmin: false, authError: null };

/**
 * Extracts and verifies the access token from an HTTP request.
 * Returns a minimal auth object that the Apollo context merges with prisma and loaders.
 *
 * Secure isolation: trusted context fields come ONLY from the cryptographically verified JWT payload.
 * `authError` lets resolvers distinguish "no token" from "expired token" (both surface to the
 * client as UNAUTHENTICATED, which is what makes the frontend refresh and retry).
 */
const authMiddlewareGraphQL = (req) => {
  const token = extractBearerToken(req.headers?.authorization);

  if (!token) {
    return { ...ANONYMOUS, authError: 'TOKEN_MISSING' };
  }

  try {
    const decoded = verifyAccessToken(token);
    const isSuper = decoded.role === 'SUPER_ADMIN';
    return {
      userId: decoded.userId,
      companyId: isSuper ? null : decoded.companyId,
      userRole: decoded.role,
      isSuperAdmin: isSuper,
      authError: null,
      user: { id: decoded.userId, email: decoded.email, role: decoded.role },
    };
  } catch (error) {
    if (error.code !== 'TOKEN_EXPIRED') {
      logger.warn('GraphQL JWT Verification Error', { code: error.code, path: req.originalUrl || req.url });
    }
    return { ...ANONYMOUS, authError: error.code || 'TOKEN_INVALID' };
  }
};

export default authMiddlewareGraphQL;
