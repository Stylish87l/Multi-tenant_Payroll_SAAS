import { describe, test, expect } from '@jest/globals';
import { hasPermission, canReadEmployeeField, assertEmployeeInputPermissions, redactEmployeeForRole } from '../policies/permissions.js';

describe('central role permission policy', () => {
  test('does not grant HR compensation or bank account visibility', () => {
    expect(canReadEmployeeField('HR', 'basicSalary')).toBe(false);
    expect(canReadEmployeeField('HR', 'bankAccount')).toBe(false);
    expect(canReadEmployeeField('HR', 'ghanaCardPin')).toBe(true);
  });

  test('allows accountants payroll-required compensation and bank fields', () => {
    expect(canReadEmployeeField('ACCOUNTANT', 'basicSalary')).toBe(true);
    expect(canReadEmployeeField('ACCOUNTANT', 'bankAccount')).toBe(true);
  });

  test('keeps employee data access self-service only at the permission layer', () => {
    expect(hasPermission('EMPLOYEE', 'payslip.read.own')).toBe(true);
    expect(hasPermission('EMPLOYEE', 'employee.read')).toBe(false);
  });

  test('blocks HR from writing compensation and bank details', () => {
    expect(assertEmployeeInputPermissions('HR', { basicSalary: 1000 })).toBe(false);
    expect(assertEmployeeInputPermissions('HR', { bankAccount: '123' })).toBe(false);
    expect(assertEmployeeInputPermissions('HR', { position: 'Clerk' })).toBe(true);
  });
});

test('redacts restricted employee fields in REST payloads', () => {
  const employee = {
    name: 'Example Employee',
    basicSalary: '5000',
    bankAccount: '0000000000',
    ssnitNumber: 'C000000000000',
    position: 'Officer',
  };
  const safe = redactEmployeeForRole(employee, 'HR');
  expect(safe.name).toBe('Example Employee');
  expect(safe.position).toBe('Officer');
  expect(safe.basicSalary).toBeNull();
  expect(safe.bankAccount).toBeNull();
  expect(safe.ssnitNumber).toBe(employee.ssnitNumber);
});
