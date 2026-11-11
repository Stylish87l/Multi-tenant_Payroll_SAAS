/**
 * Minimal CSV writer with spreadsheet-formula-injection protection.
 * Employee names are user-controlled; a name like `=HYPERLINK(...)` would
 * execute when an accountant opens the export in Excel. Cells starting with
 * = + - @ TAB or CR are prefixed with an apostrophe. Replaces json2csv
 * (a 6.0.0-alpha dependency that did not do this).
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Plain numbers (including negatives and toFixed() strings) are safe and must stay numeric.
  const isNumeric = typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(str);
  if (!isNumeric && FORMULA_START.test(str)) str = `'${str}`;
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

export const csvLine = (values) => `${values.map(csvCell).join(',')}\r\n`;

export const toCsv = (rows, fields) =>
  csvLine(fields) + rows.map((row) => csvLine(fields.map((f) => row[f]))).join('');
