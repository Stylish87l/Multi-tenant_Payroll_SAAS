import logger from './logger.js';
import { REFRESH_TTL_MS } from '../utils/authTokens.js';

/**
 * Shared Refresh Cookie Configuration
 *
 * CRITICAL: This is the SINGLE SOURCE OF TRUTH for refresh cookie options.
 * It prevents browser duplication bugs caused by disparate paths/attributes.
 *
 * PATH SCOPING NOTE:
 * Refresh rotation is a REST route (POST /api/auth/refresh) while login happens
 * via GraphQL (/graphql). The cookie path MUST encompass both, so it is '/'.
 */
export const REFRESH_COOKIE_NAME = 'refreshToken';
export const REFRESH_COOKIE_PATH = '/';
// Derived from JWT_REFRESH_EXPIRES_IN so JWT, DB row and cookie always agree.
export const REFRESH_COOKIE_MAX_AGE_MS = REFRESH_TTL_MS;

/** Optional shared parent domain for the refresh cookie, e.g. ".paylio.com". */
const COOKIE_DOMAIN = process.env.REFRESH_COOKIE_DOMAIN?.trim() || undefined;

if (process.env.NODE_ENV === 'production' && !COOKIE_DOMAIN) {
  logger.warn(
    'REFRESH_COOKIE_DOMAIN is not set. Safari/iOS users will be logged out ' +
    'immediately after login due to ITP blocking the cross-site refresh cookie. ' +
    'Ensure frontend and backend share an eTLD+1 domain mapping.'
  );
}

const baseOptions = () => {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd, // HTTPS only in production
    sameSite: isProd ? 'none' : 'lax', // 'none' = cross-domain in prod; 'lax' = plain localhost HTTP
    path: REFRESH_COOKIE_PATH,
    ...(isProd && COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  };
};

export const getRefreshCookieOptions = () => ({ ...baseOptions(), maxAge: REFRESH_COOKIE_MAX_AGE_MS });

/** Express 5 ignores maxAge/expires on clearCookie, so only the matching attributes are passed. */
export const getClearCookieOptions = () => baseOptions();
