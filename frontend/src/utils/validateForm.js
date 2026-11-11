/**
 * Async Zod form validation. Now actually used (Employees.jsx); previously dead code whose own usage
 * example imported an `employeeSchema` export that did not exist.
 * @returns {Promise<{valid: boolean, errors: Record<string,string>, data: any|null}>}
 */
const pathToString = (path) =>
  path.reduce((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : String(seg)), '');

export const validateForm = async (schema, data) => {
  const result = await schema.safeParseAsync(data);
  if (result.success) return { valid: true, errors: {}, data: result.data };

  const errors = {};
  for (const issue of result.error.issues) {
    const key = pathToString(issue.path) || '_global';
    if (!errors[key]) errors[key] = issue.message; // first message per field
  }
  return { valid: false, errors, data: null };
};

export default validateForm;
