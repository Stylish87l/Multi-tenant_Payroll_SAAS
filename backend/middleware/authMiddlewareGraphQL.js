import { verifyAccessToken } from '../utils/authTokens.js';
import logger from '../config/logger.js';

/**
 * Extracts and verifies the access token from an HTTP request.
 * Returns a minimal auth object that the Apollo context will merge with prisma and loaders.
 */
const authMiddlewareGraphQL = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization || req.get?.('authorization') || '';
  const raw = typeof authHeader === 'string' ? authHeader.trim() : '';
  const token = raw.startsWith('Bearer ') ? raw.split(' ')[1] : null;

  if (!token) {
    // Don't log warnings for health checks or public routes
    if (!req.originalUrl?.includes('/health')) {
      logger.warn('Auth Failed: No token provided', { path: req.originalUrl || req.url, ip: req.ip });
    }
    return { userId: null, companyId: null, userRole: null };
  }

  try {
    const decoded = verifyAccessToken(token);

    return {
      userId: decoded.userId,
      companyId: decoded.role === 'SUPER_ADMIN' ? null : decoded.companyId,
      userRole: decoded.role,
      user: {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      },
    };
  } catch (error) {
    logger.error('JWT Verification Error', { message: error.message, path: req.originalUrl || req.url });
    return { userId: null, companyId: null, userRole: null };
  }
};

export default authMiddlewareGraphQL;