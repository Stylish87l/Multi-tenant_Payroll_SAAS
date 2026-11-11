/**
 * AppError - an error whose message is SAFE to show to the client.
 *
 * Anything that is NOT an AppError (Prisma errors, TypeErrors, provider SDK
 * errors, ...) is treated as an internal failure: logged in full, but masked
 * in production responses by errorHandler.js (REST) and formatError (GraphQL).
 *
 * `code` doubles as the GraphQL `extensions.code`. The frontend's apolloClient
 * errorLink relies on UNAUTHENTICATED to trigger a silent token refresh.
 */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'BAD_USER_INPUT' } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export const unauthenticated = (msg = 'Authentication required') =>
  new AppError(msg, { status: 401, code: 'UNAUTHENTICATED' });
export const forbidden = (msg = 'You do not have permission to perform this action') =>
  new AppError(msg, { status: 403, code: 'FORBIDDEN' });
export const notFound = (msg = 'Resource not found') =>
  new AppError(msg, { status: 404, code: 'NOT_FOUND' });
export const badInput = (msg = 'Invalid input') =>
  new AppError(msg, { status: 400, code: 'BAD_USER_INPUT' });
export const conflict = (msg = 'Conflict') =>
  new AppError(msg, { status: 409, code: 'CONFLICT' });

/** Collapse a ZodError into one readable client-safe message. */
export const zodToAppError = (err) => {
  const msg = err.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
  return badInput(msg || 'Invalid input');
};
