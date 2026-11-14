import { badInput } from '../utils/appError.js';

/**
 * Shared employee/login identity linking.
 * Keep this relation consistent regardless of which onboarding path creates
 * the employee profile or account first.
 */
export const findEmployeeLoginUserId = async (tx, { email, companyId }) => {
  const user = await tx.user.findFirst({
    where: {
      email,
      companyId,
      role: 'EMPLOYEE',
      status: { in: ['PENDING', 'ACTIVE'] },
      deletedAt: null,
    },
    select: { id: true },
  });
  return user?.id ?? null;
};

export const linkEmployeeProfileToUser = async (tx, { email, companyId, userId }) => {
  const employee = await tx.employee.findFirst({
    where: { email, companyId, deletedAt: null },
    select: { id: true, userId: true },
  });

  if (employee?.userId && employee.userId !== userId) {
    throw badInput('This employee profile is already linked to another account.');
  }

  if (employee && !employee.userId) {
    await tx.employee.update({ where: { id: employee.id }, data: { userId } });
  }

  return employee;
};
