/**
 * Central PII / secret redaction. Used by the Winston logger (so NOTHING
 * sensitive can reach log files regardless of what a caller passes) and by
 * errorHandler.js. Ghana Card PINs, SSNIT numbers and bank accounts are
 * personal data under the Data Protection Act, 2012 (Act 843).
 */
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'password', 'newpassword', 'currentpassword',
  'token', 'accesstoken', 'refreshtoken', 'authorization', 'cookie', 'set-cookie',
  'secret', 'apikey', 'api_key',
  'bankaccount', 'bankname', 'ghanacardpin', 'ssnitnumber',
  'x-paystack-signature', 'x-hubtel-webhook-secret',
]);

export const isSensitiveKey = (key) => SENSITIVE_KEYS.has(String(key).toLowerCase());

const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export const redact = (value, depth = 0, seen = new WeakSet()) => {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  if (!isPlainObject(value)) return value; // Errors, Dates, Decimals, Buffers: leave intact

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
};
