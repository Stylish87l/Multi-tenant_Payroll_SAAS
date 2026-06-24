import { verifyAccessToken } from '../utils/authTokens.js';
import logger from '../config/logger.js';

/**
 * JWT Authentication Middleware
 * Validates the token and scopes the request to a specific user and tenant.
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization || req.get?.('authorization') || '';
  const raw = typeof authHeader === 'string' ? authHeader.trim() : '';
  const token = raw.startsWith('Bearer ') ? raw.split(' ')[1] : null;

  if (!token) {
    logger.warn('Auth Failed: No token provided', { path: req.originalUrl, ip: req.ip });
    return res.status(401).json({ error: 'Authentication token missing' });
  }

  try {
    const decoded = verifyAccessToken(token);

    // Attach identity and tenant scope
    req.userId = decoded.userId;
    req.userRole = decoded.role;

    // SUPER_ADMIN is global, not tied to a tenant
    req.companyId = decoded.role === 'SUPER_ADMIN' ? null : decoded.companyId;

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    logger.error('JWT Verification Error', {
      message: error.message,
      path: req.originalUrl,
      stack: error.stack,
    });

    const isExpired = String(error.message).toLowerCase().includes('expired');
    const status = isExpired ? 401 : 403;
    const message = isExpired ? 'Session expired' : 'Invalid token';

    return res.status(status).json({ error: message });
  }
};

export default authMiddleware;
