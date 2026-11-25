import crypto from 'node:crypto';

const ENVELOPE_PREFIX = 'enc:v1:';
const TEST_KEY = Buffer.alloc(32, 0x50).toString('base64');
const TEST_INDEX_KEY = Buffer.alloc(32, 0x49).toString('base64');

const decodeKey = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error(`${label} must be a base64-encoded 32-byte key.`);
  return key;
};

const getKeyring = () => {
  const currentKeyValue = process.env.DATA_ENCRYPTION_KEY
    || (process.env.NODE_ENV === 'test' ? TEST_KEY : null);
  const currentKeyId = process.env.DATA_ENCRYPTION_KEY_ID || 'v1';
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(currentKeyId)) throw new Error('DATA_ENCRYPTION_KEY_ID must contain 1-32 letters, numbers, underscores or hyphens.');
  const keys = new Map([[currentKeyId, decodeKey(currentKeyValue, 'DATA_ENCRYPTION_KEY')]]);
  const previousRaw = process.env.DATA_ENCRYPTION_PREVIOUS_KEYS || '{}';
  let previous;
  try { previous = JSON.parse(previousRaw); } catch { throw new Error('DATA_ENCRYPTION_PREVIOUS_KEYS must be a JSON object of key IDs to base64 keys.'); }
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) throw new Error('DATA_ENCRYPTION_PREVIOUS_KEYS must be a JSON object.');
  for (const [keyId, value] of Object.entries(previous)) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error('Previous encryption key IDs must contain 1-32 letters, numbers, underscores or hyphens.');
    if (keys.has(keyId)) throw new Error(`Encryption key ID "${keyId}" is configured more than once.`);
    keys.set(keyId, decodeKey(value, `DATA_ENCRYPTION_PREVIOUS_KEYS[${keyId}]`));
  }
  return { currentKeyId, keys };
};

const getIndexKey = () => decodeKey(
  process.env.DATA_ENCRYPTION_INDEX_KEY
    || (process.env.NODE_ENV === 'test' ? TEST_INDEX_KEY : null),
  'DATA_ENCRYPTION_INDEX_KEY',
);

export const validateEmployeePiiEncryptionConfig = () => {
  const { keys, currentKeyId } = getKeyring();
  const indexKey = getIndexKey();
  if ([...keys.values()].some((key) => key.equals(indexKey))) throw new Error('DATA_ENCRYPTION_INDEX_KEY must be different from all DATA_ENCRYPTION_KEY values.');
  return true;
};

const encryptWithCurrentKey = (value) => {
  const { currentKeyId, keys } = getKeyring();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys.get(currentKeyId), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['enc', 'v1', currentKeyId, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
};

export const getCurrentEmployeePiiKeyId = () => getKeyring().currentKeyId;

export const getEmployeePiiCiphertextKeyId = (value) => {
  if (typeof value !== 'string' || !value.startsWith(ENVELOPE_PREFIX)) return null;
  return value.split(':')[2] || null;
};

export const encryptSensitiveValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError('Sensitive employee fields must be strings or null.');
  if (!value.length) return null;
  return encryptWithCurrentKey(value);
};

export const reencryptSensitiveValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return encryptWithCurrentKey(decryptSensitiveValue(value));
};

export const decryptSensitiveValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.startsWith(ENVELOPE_PREFIX)) {
    throw new Error('Employee PII ciphertext is missing or malformed. Complete the employee PII backfill before serving requests.');
  }
  const [, version, keyId, ivEncoded, tagEncoded, ciphertextEncoded] = value.split(':');
  if (version !== 'v1' || !keyId || !ivEncoded || !tagEncoded || ciphertextEncoded === undefined) {
    throw new Error('Unsupported or malformed employee PII ciphertext envelope.');
  }
  const { keys } = getKeyring();
  const key = keys.get(keyId);
  if (!key) throw new Error(`Employee PII encryption key "${keyId}" is not configured.`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

const normalizeIdentifier = (value) => String(value).normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');

export const createEmployeePiiBlindIndex = (value, field) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('Sensitive employee identifiers must be strings or null.');
  if (!['ssnitNumber', 'ghanaCardPin'].includes(field)) throw new Error('Unsupported employee PII blind-index field.');
  const digest = crypto.createHmac('sha256', getIndexKey())
    .update(`${field}:${normalizeIdentifier(value)}`, 'utf8')
    .digest('hex');
  return `hmac:v1:${digest}`;
};

export const encryptEmployeeWriteData = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const next = { ...data };
  const fields = [
    ['bankAccount', 'bankAccountEncrypted', null],
    ['ssnitNumber', 'ssnitNumberEncrypted', 'ssnitNumberHash'],
    ['ghanaCardPin', 'ghanaCardPinEncrypted', 'ghanaCardPinHash'],
  ];
  for (const [plainField, encryptedField, hashField] of fields) {
    if (!Object.prototype.hasOwnProperty.call(next, plainField) || next[plainField] === undefined) continue;
    const value = next[plainField];
    next[encryptedField] = encryptSensitiveValue(value);
    if (hashField) next[hashField] = createEmployeePiiBlindIndex(value, plainField);
    delete next[plainField];
  }
  return next;
};

const encryptWhereFilter = (value, field) => {
  if (typeof value === 'string' || value === null) return createEmployeePiiBlindIndex(value, field);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Unsupported ${field} filter. Use exact equality or an in/not filter.`);
  const next = {};
  for (const [operator, operand] of Object.entries(value)) {
    if (operator === 'equals') next.equals = createEmployeePiiBlindIndex(operand, field);
    else if (operator === 'in' || operator === 'notIn') next[operator] = operand.map((entry) => createEmployeePiiBlindIndex(entry, field));
    else if (operator === 'not') next.not = encryptWhereFilter(operand, field);
    else throw new Error(`${field} supports exact equality only; substring/range searches are disabled for encrypted identifiers.`);
  }
  return next;
};

const encryptEmployeeWhere = (where) => {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return where;
  const next = { ...where };
  for (const logical of ['AND', 'OR', 'NOT']) {
    if (Array.isArray(next[logical])) next[logical] = next[logical].map(encryptEmployeeWhere);
    else if (next[logical] && typeof next[logical] === 'object') next[logical] = encryptEmployeeWhere(next[logical]);
  }
  for (const [plainField, hashField] of [['ssnitNumber', 'ssnitNumberHash'], ['ghanaCardPin', 'ghanaCardPinHash']]) {
    if (Object.prototype.hasOwnProperty.call(next, plainField)) {
      next[hashField] = encryptWhereFilter(next[plainField], plainField);
      delete next[plainField];
    }
    const composite = `companyId_${plainField}`;
    if (next[composite]) {
      const { companyId, [plainField]: identifier } = next[composite];
      next[`companyId_${hashField}`] = { companyId, [hashField]: createEmployeePiiBlindIndex(identifier, plainField) };
      delete next[composite];
    }
  }
  return next;
};

const transformMany = (data) => Array.isArray(data)
  ? data.map(encryptEmployeeWriteData)
  : encryptEmployeeWriteData(data);

export const createEmployeePiiEncryptionExtension = () => ({
  name: 'employee-pii-encryption',
  query: {
    employee: {
      async $allOperations({ operation, args, query }) {
        if (args.where) args.where = encryptEmployeeWhere(args.where);
        if (['create', 'update', 'updateMany', 'createMany', 'createManyAndReturn', 'updateManyAndReturn'].includes(operation) && args.data !== undefined) {
          args.data = transformMany(args.data);
        }
        if (operation === 'upsert') {
          args.create = encryptEmployeeWriteData(args.create);
          args.update = encryptEmployeeWriteData(args.update);
        }
        return query(args);
      },
    },
  },
  result: {
    employee: {
      bankAccount: {
        needs: { bankAccountEncrypted: true },
        compute: (employee) => decryptSensitiveValue(employee.bankAccountEncrypted),
      },
      ssnitNumber: {
        needs: { ssnitNumberEncrypted: true },
        compute: (employee) => decryptSensitiveValue(employee.ssnitNumberEncrypted),
      },
      ghanaCardPin: {
        needs: { ghanaCardPinEncrypted: true },
        compute: (employee) => decryptSensitiveValue(employee.ghanaCardPinEncrypted),
      },
    },
  },
});
