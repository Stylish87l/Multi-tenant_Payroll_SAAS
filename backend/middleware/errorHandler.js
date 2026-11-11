import { z } from 'zod';
import logger from '../config/logger.js';
import { Prisma } from '../config/db.js';

const isProd = () => process.env.NODE_ENV === 'production';

/** 404 for any /api path nothing else handled (mounted after all routers). */
export const notFoundHandler = (req, res) => {
  res.status(404).json({ error: 'Not found' });
};

/**
 * Global REST error handler. IMPORTANT: this was never mounted in server.js, so
 * every `next(err)` fell through to Express's default handler (HTML, stack traces).
 *
 * Request bodies are logged through the Winston redaction format, which scrubs
 * passwords, tokens, bank accounts, Ghana Card PINs and SSNIT numbers.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status =
    Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status
      : Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode
        : 500;

  const logMeta = {
    path: req.path,
    method: req.method,
    body: req.body,
    user: req.userId || 'anonymous',
    role: req.userRole || 'unknown',
    stack: isProd() ? undefined : err.stack,
    type: err.name,
    code: err.code,
  };
  // Client mistakes are not server errors: keep them out of the error log.
  if (status >= 500) logger.error(err.message || 'Internal Server Error', logMeta);
  else logger.warn(err.message || 'Request rejected', logMeta);

  // Prisma (instanceof can fail across CJS/ESM boundaries, so also check by name)
  if (err instanceof Prisma.PrismaClientKnownRequestError || err?.name === 'PrismaClientKnownRequestError') {
    switch (err.code) {
      case 'P2002': // Deliberately generic: naming the constraint would confirm another tenant's record exists.
        return res.status(409).json({ error: 'A record with these details already exists.' });
      case 'P2025':
        return res.status(404).json({ error: 'The requested record was not found.' });
      default:
        return res.status(400).json({ error: 'Database operation failed.' });
    }
  }

  if (err instanceof z.ZodError) {
    return res.status(400).json({
      errors: err.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid or malformed authentication token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  // 4xx errors carry client-safe messages (AppError, body-parser 400/413, CORS 403).
  // 5xx messages are masked in production so internals never leak.
  const message =
    status < 500 ? err.message
      : isProd() ? 'An unexpected error occurred. Please contact support.'
        : err.message || 'Internal Server Error';

  return res.status(status).json({ error: message, ...(err.code && status < 500 ? { code: err.code } : {}) });
};

export default errorHandler;
