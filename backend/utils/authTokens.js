import jwt from 'jsonwebtoken';
import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import logger from '../config/logger.js';

/**
 * Duration parsing. REFRESH_EXPIRES was previously configurable via env while
 * computeExpiryDate() and the cookie maxAge were hard-coded to 7 days, so
 * changing the env var silently desynchronised the JWT, DB row and cookie.
 * All three now derive from the same value.
 */
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export const parseDurationMs = (value) => {
  const str = String(value).trim();
  if (/^\d+$/.test(str)) return Number(str) * 1000; // jsonwebtoken: bare number = seconds
  const match = /^(\d+)\s*([smhd])$/i.exec(str);
  if (!match) throw new Error(`Unsupported duration "${value}" (use e.g. 15m, 12h, 7d)`);
  return Number(match[1]) * UNIT_MS[match[2].toLowerCase()];
};

const durationSchema = z
  .string()
  .nonempty()
  .refine((v) => { try { parseDurationMs(v); return true; } catch { return false; } }, 'Use a duration like 15m, 12h or 7d')
  .optional();

const envSchema = z.object({
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: durationSchema,
  JWT_REFRESH_EXPIRES_IN: durationSchema,
}).refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
  message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
  path: ['JWT_REFRESH_SECRET'],
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  // console.error as well: Winston transports flush asynchronously and process.exit would eat the message.
  console.error('Environment Validation Failed', parsedEnv.error.issues);
  logger.error('Environment Validation Failed', { errors: parsedEnv.error.issues });
  process.exit(1);
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export const REFRESH_TTL_MS = parseDurationMs(REFRESH_EXPIRES);

const authError = (code, message) => {
  const err = new Error(message);
  err.code = code; // TOKEN_MISSING | TOKEN_EXPIRED | TOKEN_INVALID
  err.status = 401;
  return err;
};

/** Extracts the token from an "Authorization: Bearer <token>" header value. */
export const extractBearerToken = (headerValue) => {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(headerValue.trim());
  return match ? match[1] : null;
};

export const signAccessToken = (payload) => {
  const tracer = trace.getTracer('auth-service');
  return tracer.startActiveSpan('signAccessToken', (span) => {
    try {
      const token = jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES, algorithm: 'HS256' });
      span.setAttributes({
        'auth.token.type': 'access',
        'auth.token.expiry': ACCESS_EXPIRES,
        'auth.userId': payload.userId,
        'auth.role': payload.role,
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
 * Throws an error carrying `.code`. Previously every failure was re-wrapped as
 * "Invalid or expired access token", so middleware/auth.js's expired-vs-invalid
 * branch (which string-matched 'expired') could never take the 403 path.
 * `algorithms` is pinned so a forged token cannot choose its own algorithm.
 */
export const verifyAccessToken = (token) => {
  if (!token) throw authError('TOKEN_MISSING', 'No access token provided');
  try {
    return jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw authError('TOKEN_EXPIRED', 'Access token expired');
    logger.warn('Access token verification failed', { message: err.message });
    throw authError('TOKEN_INVALID', 'Invalid access token');
  }
};

export const signRefreshToken = (payload) => {
  try {
    return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES, algorithm: 'HS256' });
  } catch (err) {
    logger.error('Sign Refresh Token Error', { stack: err.stack });
    throw err;
  }
};

export const verifyRefreshToken = (token) => {
  if (!token) throw authError('TOKEN_MISSING', 'No refresh token provided');
  try {
    return jwt.verify(token, REFRESH_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw authError('TOKEN_EXPIRED', 'Refresh token expired');
    logger.warn('Refresh token verification failed', { message: err.message });
    throw authError('TOKEN_INVALID', 'Invalid refresh token');
  }
};

export const computeExpiryDate = () => new Date(Date.now() + REFRESH_TTL_MS);
