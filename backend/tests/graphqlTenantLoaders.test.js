import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const prisma = {
  company: { findMany: jest.fn() },
  payrollRun: { findMany: jest.fn() },
  payrollItem: { groupBy: jest.fn(), findMany: jest.fn() },
};
class Decimal { constructor(value) { this.value = value; } }
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma, Prisma: { Decimal } }));
const { createLoaders } = await import('../graphql/loaders.js');

beforeEach(() => jest.clearAllMocks());

describe('GraphQL tenant-scoped DataLoaders', () => {
  test('restricts company loading to the authenticated tenant', async () => {
    prisma.company.findMany.mockResolvedValue([]);
    const loaders = createLoaders({ companyId: 'tenant-a', userRole: 'HR' });
    await expect(loaders.company.load('tenant-b')).resolves.toBeNull();
    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: { AND: [{ id: { in: ['tenant-b'] } }, { id: 'tenant-a' }] },
    });
  });

  test('restricts payroll run loading to the authenticated tenant', async () => {
    prisma.payrollRun.findMany.mockResolvedValue([]);
    const loaders = createLoaders({ companyId: 'tenant-a', userRole: 'ACCOUNTANT' });
    await expect(loaders.payrollRunLoader.load('run-b')).resolves.toBeNull();
    expect(prisma.payrollRun.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['run-b'] }, companyId: 'tenant-a' },
    });
  });

  test('fails closed when a non-platform request has no tenant context', async () => {
    prisma.payrollRun.findMany.mockResolvedValue([]);
    const loaders = createLoaders({ userRole: 'EMPLOYEE' });
    await expect(loaders.payrollRunLoader.load('run-a')).resolves.toBeNull();
    expect(prisma.payrollRun.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['run-a'] }, companyId: '__unauthenticated__' },
    });
  });

  test('keeps platform-wide lookup explicit for SUPER_ADMIN', async () => {
    prisma.payrollRun.findMany.mockResolvedValue([{ id: 'run-a', companyId: 'tenant-b' }]);
    const loaders = createLoaders({ userRole: 'SUPER_ADMIN' });
    await expect(loaders.payrollRunLoader.load('run-a')).resolves.toEqual({ id: 'run-a', companyId: 'tenant-b' });
    expect(prisma.payrollRun.findMany).toHaveBeenCalledWith({ where: { id: { in: ['run-a'] } } });
  });
});
