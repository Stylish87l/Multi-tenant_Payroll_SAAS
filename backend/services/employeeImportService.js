import ExcelJS from 'exceljs';
import employeeSchema, { validateEmployeeBusinessRules } from '../schemas/employeeSchema.js';
import { createEmployeePiiBlindIndex } from './employeePiiEncryption.js';

export class EmployeeImportInputError extends Error {}

export const MAX_IMPORT_FILE_BYTES = 700 * 1024;
export const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_COLUMNS = 40;

const aliases = {
  name: ['name', 'full name', 'employee name', 'employee full name'],
  email: ['email', 'email address', 'work email'],
  position: ['position', 'job title', 'designation', 'role'],
  basicSalary: ['basic salary', 'monthly salary', 'salary', 'basic pay'],
  housingAllowance: ['housing allowance', 'housing'],
  transportAllowance: ['transport allowance', 'transport'],
  otherAllowance: ['other allowance', 'additional allowance'],
  age: ['age'],
  isMarried: ['married', 'is married', 'marital status'],
  hasResponsibility: ['has responsibility', 'responsibility'],
  childrenCount: ['children count', 'number of children', 'children'],
  isDisabled: ['is disabled', 'disabled'],
  agedDependentsCount: ['aged dependents count', 'aged dependents'],
  bankName: ['bank name', 'bank'],
  bankCode: ['bank code', 'branch code'],
  bankAccount: ['bank account', 'account number', 'bank account number'],
  ssnitNumber: ['ssnit', 'ssnit number', 'social security number'],
  ghanaCardPin: ['ghana card pin', 'ghana card', 'national id number'],
  isActive: ['is active', 'active', 'employment status'],
};

const normalizeHeader = (value) => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const headerAliases = new Map();
for (const [field, values] of Object.entries(aliases)) {
  for (const value of [field, ...values]) headerAliases.set(normalizeHeader(value), field);
}

const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return cellText(value.result);
    return '';
  }
  return String(value).trim();
};

export const parseCsvRecords = (source) => {
  const text = String(source || '').replace(/^\uFEFF/, '');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      field = '';
      if (record.some((cell) => String(cell).trim() !== '')) records.push(record);
      record = [];
    } else field += char;
  }

  if (quoted) throw new EmployeeImportInputError('The CSV file contains an unclosed quoted field.');
  record.push(field);
  if (record.some((cell) => String(cell).trim() !== '')) records.push(record);
  return records;
};

const parseFileRecords = async ({ fileName, buffer }) => {
  const extension = String(fileName || '').toLowerCase().split('.').pop();
  if (extension === 'csv') return parseCsvRecords(buffer.toString('utf8'));
  if (extension !== 'xlsx') throw new EmployeeImportInputError('Upload a .csv or .xlsx file. Legacy .xls files are not supported.');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('The workbook does not contain a worksheet.');
  const records = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    records.push(row.values.slice(1).map(cellText));
  });
  return records;
};

const parseBoolean = (value) => {
  if (value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'married', 'active', 'disabled'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0', 'single', 'inactive', 'not disabled'].includes(normalized)) return false;
  return value;
};

const toEmployeeInput = (record, mapping) => {
  const input = {};
  for (const [field, columnIndex] of Object.entries(mapping)) {
    const raw = cellText(record[columnIndex]);
    if (raw === '') continue;
    input[field] = ['isMarried', 'hasResponsibility', 'isDisabled', 'isActive'].includes(field)
      ? parseBoolean(raw)
      : raw;
  }
  return input;
};

const addError = (row, message) => {
  if (!row.errors.includes(message)) row.errors.push(message);
};

const validateRows = async ({ rows, companyId, client }) => {
  const validated = rows.map((row) => {
    const parsed = employeeSchema.safeParse(row.data);
    const errors = [...(row.errors || [])];
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        addError({ errors }, `${issue.path.join('.') || 'row'}: ${issue.message}`);
      }
      return { rowNumber: row.rowNumber, data: row.data, validatedData: null, errors };
    }
    const businessError = validateEmployeeBusinessRules(parsed.data);
    if (businessError) addError({ errors }, businessError);
    return { rowNumber: row.rowNumber, data: row.data, validatedData: parsed.data, errors };
  });

  const candidates = validated.filter((row) => row.validatedData && !row.errors.length);
  const seen = { email: new Set(), ssnit: new Set(), ghanaCard: new Set() };
  const emails = new Set();
  const ssnitHashes = new Set();
  const ghanaCardHashes = new Set();

  for (const row of candidates) {
    const data = row.validatedData;
    const email = data.email.toLowerCase();
    if (seen.email.has(email)) addError(row, 'Duplicate email address in this file.');
    seen.email.add(email);
    emails.add(email);

    if (data.ssnitNumber) {
      const hash = createEmployeePiiBlindIndex(data.ssnitNumber, 'ssnitNumber');
      if (seen.ssnit.has(hash)) addError(row, 'Duplicate SSNIT number in this file.');
      seen.ssnit.add(hash);
      ssnitHashes.add(hash);
    }
    if (data.ghanaCardPin) {
      const hash = createEmployeePiiBlindIndex(data.ghanaCardPin, 'ghanaCardPin');
      if (seen.ghanaCard.has(hash)) addError(row, 'Duplicate Ghana Card PIN in this file.');
      seen.ghanaCard.add(hash);
      ghanaCardHashes.add(hash);
    }
  }

  const [existingEmails, existingSsnit, existingGhanaCard] = await Promise.all([
    emails.size ? client.employee.findMany({
      where: { companyId, email: { in: [...emails], mode: 'insensitive' } }, select: { email: true },
    }) : [],
    ssnitHashes.size ? client.employee.findMany({
      where: { companyId, ssnitNumberHash: { in: [...ssnitHashes] } }, select: { ssnitNumberHash: true },
    }) : [],
    ghanaCardHashes.size ? client.employee.findMany({
      where: { companyId, ghanaCardPinHash: { in: [...ghanaCardHashes] } }, select: { ghanaCardPinHash: true },
    }) : [],
  ]);

  const existingEmailSet = new Set(existingEmails.map((row) => row.email.toLowerCase()));
  const existingSsnitSet = new Set(existingSsnit.map((row) => row.ssnitNumberHash));
  const existingGhanaCardSet = new Set(existingGhanaCard.map((row) => row.ghanaCardPinHash));

  for (const row of candidates) {
    const data = row.validatedData;
    if (existingEmailSet.has(data.email.toLowerCase())) addError(row, 'Email address already exists in this company.');
    if (data.ssnitNumber && existingSsnitSet.has(createEmployeePiiBlindIndex(data.ssnitNumber, 'ssnitNumber'))) {
      addError(row, 'SSNIT number already exists in this company.');
    }
    if (data.ghanaCardPin && existingGhanaCardSet.has(createEmployeePiiBlindIndex(data.ghanaCardPin, 'ghanaCardPin'))) {
      addError(row, 'Ghana Card PIN already exists in this company.');
    }
  }

  return validated.map((row) => ({
    rowNumber: row.rowNumber,
    data: row.validatedData || row.data,
    errors: row.errors,
  }));
};

export const buildEmployeeImportPreview = async ({ fileName, buffer, companyId, client }) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new EmployeeImportInputError('The uploaded file is empty.');
  if (buffer.length > MAX_IMPORT_FILE_BYTES) throw new EmployeeImportInputError('The file is too large. Maximum upload size is 700 KB.');

  let records;
  try {
    records = await parseFileRecords({ fileName, buffer });
  } catch (error) {
    if (error instanceof EmployeeImportInputError) throw error;
    throw new EmployeeImportInputError('The uploaded file could not be read. Check that it is a valid CSV or XLSX workbook.');
  }
  if (records.length < 2) throw new EmployeeImportInputError('The file must include a header row and at least one employee row.');
  const headers = records[0].map(cellText);
  if (headers.length > MAX_IMPORT_COLUMNS) throw new EmployeeImportInputError(`The file may contain at most ${MAX_IMPORT_COLUMNS} columns.`);

  const mapping = {};
  const mappedHeaderIndexes = new Set();
  const duplicateMappings = [];
  headers.forEach((header, index) => {
    const field = headerAliases.get(normalizeHeader(header));
    if (!field) return;
    if (Object.hasOwn(mapping, field)) duplicateMappings.push(field);
    else {
      mapping[field] = index;
      mappedHeaderIndexes.add(index);
    }
  });
  if (duplicateMappings.length) throw new EmployeeImportInputError(`Multiple columns map to the same field: ${[...new Set(duplicateMappings)].join(', ')}.`);

  const required = ['name', 'email', 'position', 'basicSalary'];
  const missing = required.filter((field) => !Object.hasOwn(mapping, field));
  if (missing.length) throw new EmployeeImportInputError(`Missing required columns: ${missing.join(', ')}.`);

  const rawRows = records.slice(1).filter((record) => record.some((value) => cellText(value) !== ''));
  if (rawRows.length > MAX_IMPORT_ROWS) throw new EmployeeImportInputError(`The file contains too many rows. Maximum is ${MAX_IMPORT_ROWS}.`);
  const rows = rawRows.map((record, index) => ({
    rowNumber: index + 2,
    data: toEmployeeInput(record, mapping),
    errors: [],
  }));
  const validatedRows = await validateRows({ rows, companyId, client });
  const validRows = validatedRows.filter((row) => row.errors.length === 0).length;
  const invalidRows = validatedRows.length - validRows;

  const mappingLabels = Object.fromEntries(Object.entries(mapping).map(([field, index]) => [field, headers[index]]));
  const ignoredHeaders = headers.filter((header, index) => !mappedHeaderIndexes.has(index));
  const displayRows = validatedRows.map((row) => ({
    rowNumber: row.rowNumber,
    name: row.data.name || '',
    email: row.data.email || '',
    position: row.data.position || '',
    basicSalary: row.data.basicSalary === undefined ? null : String(row.data.basicSalary),
    sensitiveFieldsDetected: ['bankAccount', 'ssnitNumber', 'ghanaCardPin'].filter((field) => Boolean(row.data[field])),
    valid: row.errors.length === 0,
    errors: row.errors,
  }));

  return {
    payload: { rows: validatedRows, mapping: mappingLabels },
    response: {
      summary: { totalRows: validatedRows.length, validRows, invalidRows },
      mapping: mappingLabels,
      ignoredHeaders,
      rows: displayRows,
    },
  };
};

export const validateEmployeeImportCommitRows = async ({ rows, companyId, client }) => {
  const eligible = rows.filter((row) => row.errors.length === 0);
  if (!eligible.length) {
    const error = new Error('There are no valid rows to import.');
    error.code = 'IMPORT_NO_VALID_ROWS';
    throw error;
  }
  const revalidated = await validateRows({
    rows: eligible.map(({ rowNumber, data }) => ({ rowNumber, data, errors: [] })),
    companyId,
    client,
  });
  const duplicates = revalidated.filter((row) => row.errors.length);
  if (duplicates.length) {
    const error = new Error('Some records now conflict with existing employees. Generate a new preview and review the updated duplicates.');
    error.code = 'IMPORT_DUPLICATES_CHANGED';
    error.rowNumbers = duplicates.map((row) => row.rowNumber);
    throw error;
  }
  return revalidated;
};
