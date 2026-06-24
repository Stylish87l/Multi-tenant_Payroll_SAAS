import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import logger from '../config/logger.js';

// Validate environment variables
const envSchema = z.object({
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().nonempty().optional(),
  JWT_REFRESH_EXPIRES_IN: z.string().nonempty().optional(),
});

try {
  envSchema.parse(process.env);
} catch (err) {
  logger.error('Environment Validation Failed', { errors: err.errors });
  process.exit(1);
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Sign access token
 */
export const signAccessToken = (payload) => {
  const tracer = trace.getTracer('auth-service');
  return tracer.startActiveSpan('signAccessToken', (span) => {
    try {
      const token = jwt.sign(payload, ACCESS_SECRET, {
        expiresIn: ACCESS_EXPIRES,
        algorithm: 'HS256',
      });

      span.setAttributes({
        'auth.token.type': 'access',
        'auth.token.expiry': ACCESS_EXPIRES,
        'auth.userId': payload.userId,
        'auth.role': payload.role,
        'auth.companyId': payload.role === 'SUPER_ADMIN' ? null : payload.companyId,
      });

      return token;
    } catch (error) {
      logger.error('Sign Access Token Error', { stack: error.stack });
      throw error;
    } finally {
      span.end();
    }
  });
};

/**
 * Verify access token
 */
export const verifyAccessToken = (token) => {
  if (!token) throw new Error('No access token provided');
  try {
    return jwt.verify(token, ACCESS_SECRET);
  } catch (err) {
    logger.warn('Access token verification failed', { message: err.message });
    throw new Error('Invalid or expired access token');
  }
};

/**
 * Sign refresh token (JWT)
 * Expect callers to include tokenId in payload for server-side revocation
 */
export const signRefreshToken = (payload) => {
  try {
    return jwt.sign(payload, REFRESH_SECRET, {
      expiresIn: REFRESH_EXPIRES,
      algorithm: 'HS256',
    });
  } catch (err) {
    logger.error('Sign Refresh Token Error', { stack: err.stack });
    throw err;
  }
};

/**
 * Verify refresh token (JWT)
 */
export const verifyRefreshToken = (token) => {
  if (!token) throw new Error('No refresh token provided');
  try {
    return jwt.verify(token, REFRESH_SECRET);
  } catch (err) {
    logger.warn('Refresh token verification failed', { message: err.message });
    throw new Error('Invalid or expired refresh token');
  }
};

/**
 * Generate high-entropy random token (alternative strategy)
 */
export const generateRandomToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

/**
 * Hash token for DB storage
 */
export const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Compute expiry Date (7 days)
 */
export const computeExpiryDate = () => {
  // If you change REFRESH_EXPIRES to something else, update this math too
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); 
};

/**
 * Backwards-compatible alias
 */
export const computeExpiry = computeExpiryDate;
