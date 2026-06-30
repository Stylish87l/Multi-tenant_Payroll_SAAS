/**
 * Shared Refresh Cookie Configuration
 *
 * CRITICAL: This is the SINGLE SOURCE OF TRUTH for refresh cookie options.
 * Previously, three different files (graphql/resolvers.js, routes/auth.js,
 * controllers/authController.js) each set their own cookie options with
 * different `path`, `sameSite`, and `secure` values. Because the browser
 * treats cookies with different `path`/attributes as distinct, the cookie
 * set at login was frequently not the one read back during refresh -
 * causing an immediate, deterministic logout after login.
 *
 * Frontend (Vercel) and backend (Railway) are different origins, which
 * makes every request CROSS-SITE. Cross-site cookies require:
 *   - sameSite: 'none'   (NOT 'lax' or 'strict' - those are dropped cross-site)
 *   - secure: true       (mandatory when sameSite is 'none', enforced by browsers)
 * These must NOT be conditional on NODE_ENV - both Vercel and Railway serve
 * over HTTPS in every environment that matters (including preview/staging),
 * so gating on NODE_ENV only reintroduces the bug if NODE_ENV is ever unset.
 */

export const REFRESH_COOKIE_NAME = 'refreshToken';
export const REFRESH_COOKIE_PATH = '/api/auth/refresh';
export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Options used when SETTING the refresh cookie (login, rotation).
 */
export const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: REFRESH_COOKIE_PATH,
  maxAge: REFRESH_COOKIE_MAX_AGE_MS,
});

/**
 * Options used when CLEARING the refresh cookie (logout, invalid token).
 * clearCookie must be called with the same path/sameSite/secure attributes
 * used to set it, or the browser will not recognize it as the same cookie
 * and will silently fail to clear it.
 */
export const getClearCookieOptions = () => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: REFRESH_COOKIE_PATH,
});