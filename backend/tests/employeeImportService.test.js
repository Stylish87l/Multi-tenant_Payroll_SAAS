import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import { createEmployeePiiBlindIndex } from '../services/employeePiiEncryption.js';
import {
  buildEmployeeImportPreview,
  parseCsvRecords,
  EmployeeImportInputError,
} from '../services/employeeImportService.js';

const client = { employee: { findMany: jest.fn() } };
const csv = [
  'Full Name,Email Address,Job Title,Basic Salary,Housing Allowance,SSNIT Number,Ghana Card PIN,Bank Account',
  'Ama Mensah,ama@example.test,Teacher,4500,500,1234567890123,GHA-123456789-1,1234567890',
].join('\n');

describe('smart employee import parsing and preview', () => {
  beforeEach(() => client.employee.findMany.mockReset().mockResolvedValue([]));
  afterEach(() => jest.clearAllMocks());

  it('parses quoted CSV cells, commas and escaped quotes', () => {
    expect(parseCsvRecords('Name,Position\n"Mensah, Ama","Teacher ""A"""')).toEqual([
      ['Name', 'Position'],
      ['Mensah, Ama', 'Teacher "A"'],
    ]);
  });

  it('maps common headers, validates rows and masks sensitive values in the preview response', async () => {
    const result = await buildEmployeeImportPreview({
      fileName: 'staff.csv',
      buffer: Buffer.from(csv),
      companyId: 'company-a',
      client,
    });
    expect(result.response.summary).toEqual({ totalRows: 1, validRows: 1, invalidRows: 0 });
    expect(result.response.mapping).toMatchObject({
      name: 'Full Name',
      email: 'Email Address',
      position: 'Job Title',
      basicSalary: 'Basic Salary',
      ssnitNumber: 'SSNIT Number',
      ghanaCardPin: 'Ghana Card PIN',
    });
    expect(result.response.rows[0]).toMatchObject({
      rowNumber: 2, name: 'Ama Mensah', email: 'ama@example.test',
      sensitiveFieldsDetected: ['bankAccount', 'ssnitNumber', 'ghanaCardPin'], valid: true,
    });
    expect(JSON.stringify(result.response)).not.toContain('1234567890123');
    expect(JSON.stringify(result.response)).not.toContain('GHA-123456789-1');
    expect(result.payload.rows[0].data.ssnitNumber).toBe('1234567890123');
    expect(client.employee.findMany).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(client.employee.findMany.mock.calls)).not.toContain('1234567890123');
    expect(JSON.stringify(client.employee.findMany.mock.calls)).not.toContain('GHA-123456789-1');
  });

  it('marks repeated email addresses within the file as duplicates', async () => {
    const duplicateCsv = [
      'Name,Email,Position,Basic Salary',
      'Ama Mensah,ama@example.test,Teacher,4500',
      'Ama Mensah,AMA@example.test,Teacher,4500',
    ].join('\n');
    const result = await buildEmployeeImportPreview({
      fileName: 'duplicates.csv', buffer: Buffer.from(duplicateCsv),
      companyId: 'company-a', client,
    });
    expect(result.response.summary).toEqual({ totalRows: 2, validRows: 1, invalidRows: 1 });
    expect(result.response.rows[1].errors).toContain('Duplicate email address in this file.');
  });

  it('marks identifiers already present in the tenant using blind indexes', async () => {
    client.employee.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ssnitNumberHash: createEmployeePiiBlindIndex('1234567890123', 'ssnitNumber') }])
      .mockResolvedValueOnce([]);
    const result = await buildEmployeeImportPreview({
      fileName: 'staff.csv', buffer: Buffer.from(csv),
      companyId: 'company-a', client,
    });
    expect(result.response.summary.invalidRows).toBe(1);
    expect(result.response.rows[0].errors).toContain('SSNIT number already exists in this company.');
    const identifierQuery = client.employee.findMany.mock.calls[1][0];
    expect(identifierQuery.where.ssnitNumberHash.in[0]).toMatch(/^hmac:v1:/);
    expect(JSON.stringify(identifierQuery)).not.toContain('1234567890123');
  });

  it('requires the essential employee columns and enforces upload limits', async () => {
    await expect(buildEmployeeImportPreview({
      fileName: 'bad.csv',
      buffer: Buffer.from('Name,Email\nAma,ama@example.test'),
      companyId: 'company-a', client,
    })).rejects.toBeInstanceOf(EmployeeImportInputError);

    await expect(buildEmployeeImportPreview({
      fileName: 'large.csv',
      buffer: Buffer.alloc(700 * 1024 + 1),
      companyId: 'company-a', client,
    })).rejects.toThrow('700 KB');
  });

  it('rejects XLSX archives with excessive uncompressed content before workbook parsing', async () => {
    const buffer = Buffer.alloc(100);
    buffer.writeUInt32LE(0x04034b50, 0);
    buffer.writeUInt16LE(20, 4);
    buffer.writeUInt16LE(1, 26);
    buffer.write('x', 30, 'ascii');

    const central = 31;
    buffer.writeUInt32LE(0x02014b50, central);
    buffer.writeUInt16LE(20, central + 4);
    buffer.writeUInt16LE(20, central + 6);
    buffer.writeUInt32LE(0, central + 20);
    buffer.writeUInt32LE(11 * 1024 * 1024, central + 24);
    buffer.writeUInt16LE(1, central + 28);
    buffer.write('x', central + 46, 'ascii');

    const end = 78;
    buffer.writeUInt32LE(0x06054b50, end);
    buffer.writeUInt16LE(1, end + 8);
    buffer.writeUInt16LE(1, end + 10);
    buffer.writeUInt32LE(47, end + 12);
    buffer.writeUInt32LE(central, end + 16);

    await expect(buildEmployeeImportPreview({
      fileName: 'large-workbook.xlsx', buffer, companyId: 'company-a', client,
    })).rejects.toThrow('10 MB processing limit');
  });

  it('reads the first worksheet of an XLSX workbook', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Employees');
    sheet.addRow(['Name', 'Email', 'Position', 'Basic Salary']);
    sheet.addRow(['Kojo Boateng', 'kojo@example.test', 'Driver', 3200]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await buildEmployeeImportPreview({
      fileName: 'staff.xlsx', buffer, companyId: 'company-a', client,
    });
    expect(result.response.summary.validRows).toBe(1);
    expect(result.response.rows[0].name).toBe('Kojo Boateng');
  });
});
