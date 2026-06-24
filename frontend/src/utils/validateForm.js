import { z } from 'zod';

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - true when validation passes
 * @property {Object.<string,string>} errors - map of flattened field paths to error messages
 * @property {any|null} data - transformed data from Zod when valid, otherwise null
 */

/**
 * Convert a Zod issue path array into a dot/bracket string:
 * ['address', 0, 'city'] -> "address[0].city"
 * @param {Array<string|number>} pathArray
 * @returns {string}
 */
const pathToString = (pathArray) => {
  if (!Array.isArray(pathArray) || pathArray.length === 0) return '';
  return pathArray.reduce((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc ? `${acc}.${segment}` : String(segment);
  }, '');
};

/**
 * Validate data against a Zod schema asynchronously and optionally run extra async checks.
 *
 * @param {import('zod').ZodTypeAny} schema - Zod schema to validate against.
 * @param {any} data - Raw form data to validate.
 * @param {Object} [options]
 * @param {(cleanData: any) => Promise<{ valid: boolean, errors?: Object.<string,string> }>|void} [options.postValidate]
 *        Optional async hook to run additional checks (e.g., uniqueness). Should return an object
 *        with `{ valid: false, errors: { field: 'message' } }` to surface additional errors.
 * @returns {Promise<ValidationResult>}
 */
export const validateForm = async (schema, data, options = {}) => {
  // Run Zod validation (supports transforms and async refinements)
  const result = await schema.safeParseAsync(data);

  if (!result.success) {
    // Flatten Zod issues into a simple map for form libraries / UI
    const errors = result.error.issues.reduce((acc, issue) => {
      const path = pathToString(issue.path) || '_global';
      // Keep the first message per path to keep UI simple
      if (!acc[path]) acc[path] = issue.message;
      return acc;
    }, {});

    return { valid: false, errors, data: null };
  }

  // Optionally run additional async checks (e.g., server uniqueness)
  if (typeof options.postValidate === 'function') {
    try {
      const post = await options.postValidate(result.data);
      if (post && post.valid === false) {
        // Merge/return postValidate errors (expected shape: { field: message })
        return { valid: false, errors: post.errors || { _global: 'Validation failed' }, data: null };
      }
    } catch (err) {
      // If postValidate throws, surface a generic error for UI
      return { valid: false, errors: { _global: err?.message || 'Validation hook failed' }, data: null };
    }
  }

  // Success: return transformed/clean data
  return { valid: true, errors: {}, data: result.data };
};

export default validateForm;

/* -------------------------
   Example usage:

import validateForm, { employeeSchema } from '../utils/validateForm';

const handleSubmit = async (rawForm) => {
  const { valid, errors, data } = await validateForm(employeeSchema, rawForm, {
    postValidate: async (clean) => {
      // optional server-side uniqueness check
      // const exists = await api.checkSSNIT(clean.ssnitNumber);
      // if (exists) return { valid: false, errors: { ssnitNumber: 'SSNIT already in use' } };
      return { valid: true };
    }
  });

  if (!valid) {
    // set form errors in UI
    setFormErrors(errors);
    return;
  }

  // send `data` (clean/transformed) to backend
  await createEmployee({ variables: { input: data } });
};
------------------------- */
