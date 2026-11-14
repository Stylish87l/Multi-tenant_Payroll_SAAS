import { describe, test, expect, jest } from '@jest/globals';
import { findEmployeeLoginUserId, linkEmployeeProfileToUser } from '../services/employeeIdentityService.js';

describe('employee account identity linking', () => {
  test('finds only active or pending employee accounts in the same tenant', async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }) } };

    await expect(findEmployeeLoginUserId(tx, {
      email: 'person@example.test', companyId: 'tenant-a',
    })).resolves.toBe('user-1');

    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'person@example.test',
        companyId: 'tenant-a',
        role: 'EMPLOYEE',
        status: { in: ['PENDING', 'ACTIVE'] },
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  test('returns null when no employee login exists', async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(findEmployeeLoginUserId(tx, {
      email: 'person@example.test', companyId: 'tenant-a',
    })).resolves.toBeNull();
  });

  test('links an unlinked employee profile to the invited employee account', async () => {
    const tx = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 'employee-1', userId: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await linkEmployeeProfileToUser(tx, {
      email: 'person@example.test', companyId: 'tenant-a', userId: 'user-1',
    });

    expect(tx.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'employee-1', companyId: 'tenant-a', userId: null, deletedAt: null }, data: { userId: 'user-1' },
    });
  });

  test('refuses to reassign an employee profile linked to a different login', async () => {
    const tx = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 'employee-1', userId: 'user-2' }),
        updateMany: jest.fn(),
      },
    };

    await expect(linkEmployeeProfileToUser(tx, {
      email: 'person@example.test', companyId: 'tenant-a', userId: 'user-1',
    })).rejects.toThrow(/already linked/);
    expect(tx.employee.updateMany).not.toHaveBeenCalled();
  });

  test('does not link deleted employee profiles', async () => {
    const tx = { employee: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } };

    await expect(linkEmployeeProfileToUser(tx, {
      email: 'person@example.test', companyId: 'tenant-a', userId: 'user-1',
    })).resolves.toBeNull();
    expect(tx.employee.update).not.toHaveBeenCalled();
  });
});
