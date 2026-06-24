import { z } from 'zod';

/**
 * Modern Validation Middleware
 * Validates request data against Zod schemas and passes errors to the global handler.
 * Supports body, query, and params validation with transformation/sanitization.
 */
const validate = (schemas = {}) => async (req, res, next) => {
  try {
    // Validate and overwrite with sanitized/transformed data
    if (schemas.body) {
      req.body = await schemas.body.parseAsync(req.body);
    }

    if (schemas.query) {
      req.query = await schemas.query.parseAsync(req.query);
    }

    if (schemas.params) {
      req.params = await schemas.params.parseAsync(req.params);
    }

    next();
  } catch (error) {
    // Attach metadata for the Error Handler and Logger
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.context = {
        path: req.path,
        method: req.method,
        source: 'Validation',
        role: req.userRole || 'unknown', // NEW: capture SUPER_ADMIN vs tenant role
        issues: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    next(error);
  }
};

export default validate;
