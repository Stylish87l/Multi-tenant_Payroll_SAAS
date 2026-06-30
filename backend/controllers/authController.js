// backend/controllers/authController.js
//
// DEPRECATED - DO NOT USE.
//
// This file previously implemented a THIRD, incompatible login/refresh/logout
// flow alongside graphql/resolvers.js (Mutation.login) and routes/auth.js
// (REST /refresh, /logout). It set cookies with different `path`/`sameSite`
// values, signed refresh JWTs WITHOUT the `tokenId` claim that routes/auth.js
// requires for DB lookup, and never wrote a RefreshToken row at all - meaning
// any session created through this controller could never be refreshed and
// would silently log the user out.
//
// The canonical, supported auth flow is now:
//   - Login:   graphql/resolvers.js -> Mutation.login
//   - Refresh: routes/auth.js       -> POST /api/auth/refresh
//   - Logout:  routes/auth.js       -> POST /api/auth/logout
//   - Cookie config: config/cookies.js (single source of truth)
//
// If you need a REST login endpoint, port Mutation.login's logic here and
// import getRefreshCookieOptions() from '../config/cookies.js' - do NOT
// hand-roll cookie options again.

const NOT_IMPLEMENTED = (name) => (req, res) => {
  res.status(501).json({
    error: `${name} is not implemented. Use the GraphQL Mutation.login / REST routes/auth.js flow instead. See comment at the top of controllers/authController.js.`,
  });
};

export const register = NOT_IMPLEMENTED('register');
export const login = NOT_IMPLEMENTED('login');
export const refresh = NOT_IMPLEMENTED('refresh');
export const logout = NOT_IMPLEMENTED('logout');