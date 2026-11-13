import { describe, test, expect } from '@jest/globals';
import { buildPayslipItemWhere, hasConsistentPayslipTenant } from '../utils/payslipAccess.js';

describe('payslip tenant access scope', () => {
  test('limits an employee to their own finalized payslip in their tenant', () => {
    expect(buildPayslipItemWhere({
      userRole: 'EMPLOYEE', companyId: 'tenant-a', userId: 'user-1',
    }, 'item-1')).toEqual({
      id: 'item-1',
      employee: { userId: 'user-1' },
      payrollRun: { companyId: 'tenant-a', status: 'FINALIZED' },
    });
  });

  test('limits tenant administrators to their own company', () => {
    expect(buildPayslipItemWhere({
      userRole: 'ADMIN', companyId: 'tenant-a', userId: 'admin-1',
    }, 'item-1')).toEqual({ id: 'item-1', payrollRun: { companyId: 'tenant-a' } });
  });

  test('allows Super Admin lookup across tenants for support operations', () => {
    expect(buildPayslipItemWhere({
      userRole: 'SUPER_ADMIN', companyId: null, userId: 'root-1',
    }, 'item-1')).toEqual({ id: 'item-1' });
  });

  test('rejects payroll items whose employee and payroll run belong to different tenants', () => {
    expect(hasConsistentPayslipTenant({
      payrollRun: { companyId: 'tenant-a' }, employee: { companyId: 'tenant-b' },
    })).toBe(false);
    expect(hasConsistentPayslipTenant({
      payrollRun: { companyId: 'tenant-a' }, employee: { companyId: 'tenant-a' },
    })).toBe(true);
  });
});
