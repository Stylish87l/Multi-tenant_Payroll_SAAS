import logger from '../config/logger.js';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const errorHandler = (err, req, res, next) => {
  // 1. Sanitize request body for logging (Privacy compliance)
  const safeBody = req.body ? { ...req.body } : {};
  if (safeBody.password) safeBody.password = '[REDACTED]';
  if (safeBody.token) safeBody.token = '[REDACTED]';

  // 2. Structured logging (include role awareness)
  logger.error(err.message || 'Internal Server Error', {
    path: req.path,
    method: req.method,
    body: safeBody,
    user: req.userId || 'anonymous',
    role: req.userRole || 'unknown', // NEW: capture SUPER_ADMIN vs tenant role
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    type: err.name,
    code: err.code,
  });

  // 3. Handle Prisma Errors (Database)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': // Unique constraint failed
        return res.status(409).json({ error: `Duplicate value for: ${err.meta?.target}` });
      case 'P2025': // Record not found
        return res.status(404).json({ error: 'The requested record was not found.' });
      default:
        return res.status(400).json({ error: 'Database operation failed.' });
    }
  }

  // 4. Handle Zod Errors (Validation)
  if (err instanceof z.ZodError) {
    const simplifiedErrors = err.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return res.status(400).json({ errors: simplifiedErrors });
  }

  // 5. Handle JWT/Auth Errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid or malformed authentication token.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  // 6. Default Fallback
  const statusCode = err.status || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred. Please contact support.'
      : err.message || 'Internal Server Error';

  res.status(statusCode).json({ error: message });
};

export default errorHandler;
