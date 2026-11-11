import { z } from 'zod';

/**
 * Express 5 defines req.query as a getter-only property, so `req.query = x`
 * throws in strict mode. Redefine it as an own data property instead.
 */
const assign = (req, key, value) => {
  Object.defineProperty(req, key, { value, writable: true, configurable: true, enumerable: true });
};

/**
 * Validation Middleware
 * Validates request data against Zod schemas and passes errors to the global handler.
 * Supports body, query, and params validation with transformation/sanitization.
 */
const validate = (schemas = {}) => async (req, res, next) => {
  try {
    if (schemas.body) req.body = await schemas.body.parseAsync(req.body ?? {});
    if (schemas.query) assign(req, 'query', await schemas.query.parseAsync(req.query));
    if (schemas.params) assign(req, 'params', await schemas.params.parseAsync(req.params));
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.context = {
        path: req.path,
        method: req.method,
        source: 'Validation',
        role: req.userRole || 'unknown',
        issues: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
      };
    }
    next(error);
  }
};

export default validate;
