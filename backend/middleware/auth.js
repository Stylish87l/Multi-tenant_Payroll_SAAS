import { verifyAccessToken, extractBearerToken } from '../utils/authTokens.js';
import logger from '../config/logger.js';

/**
 * JWT Authentication Middleware
 * Validates the token and scopes the request to a specific user and tenant.
 */
const authMiddleware = (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    logger.warn('Auth Failed: No token provided', { path: req.originalUrl, ip: req.ip });
    return res.status(401).json({ error: 'Authentication token missing', code: 'TOKEN_MISSING' });
  }

  try {
    const decoded = verifyAccessToken(token);

    if (!decoded?.userId || !decoded?.role) {
      return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    }

    req.userId = decoded.userId;
    req.userRole = decoded.role;
    // SUPER_ADMIN is global, not tied to a tenant
    req.companyId = decoded.role === 'SUPER_ADMIN' ? null : decoded.companyId;
    req.user = { id: decoded.userId, email: decoded.email, role: decoded.role };

    return next();
  } catch (error) {
    // 401 for BOTH expired and invalid: 403 means "authenticated but forbidden".
    const expired = error.code === 'TOKEN_EXPIRED';
    if (!expired) {
      logger.warn('JWT Verification Error', { code: error.code, path: req.originalUrl, ip: req.ip });
    }
    return res.status(401).json({
      error: expired ? 'Session expired' : 'Invalid token',
      code: error.code || 'TOKEN_INVALID',
    });
  }
};

export default authMiddleware;
