/**
 * Shared Refresh Cookie Configuration
 * 
 * CRITICAL: This is the SINGLE SOURCE OF TRUTH for refresh cookie options.
 * It prevents browser duplication bugs caused by disparate paths/attributes.
 */

export const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * PATH SCOPING NOTE: 
 * If your refresh rotation is handled by an Express REST route (e.g., POST /api/auth/refresh),
 * but your LOGIN/LOGOUT actions happen via GraphQL (e.g., /graphql), the cookie path MUST 
 * encompass both. Setting this to '/' ensures all auth subsystems can read/write/clear it.
 * If rotation, login, and logout are purely restricted to a REST router prefix, use '/api/auth'.
 */
export const REFRESH_COOKIE_PATH = '/'; 
export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Optional shared parent domain for the refresh cookie, e.g. ".paylio.com".
 */
const COOKIE_DOMAIN = process.env.REFRESH_COOKIE_DOMAIN?.trim() || undefined;

if (process.env.NODE_ENV === 'production' && !COOKIE_DOMAIN) {
  // eslint-disable-next-line no-console
  console.warn(
    '⚠️  REFRESH_COOKIE_DOMAIN is not set. Safari/iOS users will be logged out ' +
    'immediately after login due to ITP blocking the cross-site refresh cookie. ' +
    'Ensure frontend and backend share an eTLD+1 domain mapping.'
  );
}

/**
 * Options used when SETTING the refresh cookie (login, rotation).
 */
export const getRefreshCookieOptions = () => {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    // 🟢 True in production (enforces HTTPS for iOS Safari ITP safety), false on localhost HTTP
    secure: isProd,
    // 🟢 'none' allows cross-domain cookies in prod; 'lax' prevents cookie rejection on local HTTP
    sameSite: isProd ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    ...(isProd && COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  };
};

/**
 * Options used when CLEARING the refresh cookie (logout, invalid token).
 * We explicitly pass maxAge: 0 and a past date to force all engines to drop the token.
 */
export const getClearCookieOptions = () => {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: 0,
    expires: new Date(0),
    ...(isProd && COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  };
};