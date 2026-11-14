import { badInput } from '../utils/appError.js';
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export const findEmployeeLoginUserId = async (tx, { email, companyId }) => {
  const user = await tx.user.findFirst({
    where: { email: normalizeEmail(email), companyId, role: 'EMPLOYEE', status: { in: ['PENDING', 'ACTIVE'] }, deletedAt: null },
    select: { id: true },
  });
  return user?.id ?? null;
};

export const linkEmployeeProfileToUser = async (tx, { email, companyId, userId }) => {
  const employee = await tx.employee.findFirst({
    where: { email: normalizeEmail(email), companyId, deletedAt: null },
    select: { id: true, userId: true },
  });
  if (employee?.userId && employee.userId !== userId) throw badInput('This employee profile is already linked to another account.');
  if (employee && !employee.userId) {
    const result = await tx.employee.updateMany({
      where: { id: employee.id, companyId, userId: null, deletedAt: null }, data: { userId },
    });
    if (result.count !== 1) throw badInput('Employee account link changed concurrently. Retry the operation.');
  }
  return employee;
};

export const reconcileEmployeeAccountLinks = async (tx, { companyId } = {}) => {
  const summary = { scanned: 0, linked: 0, unmatched: 0, conflicts: 0 };
  let cursor = null;
  while (true) {
    const employees = await tx.employee.findMany({
      where: { ...(companyId ? { companyId } : {}), userId: null, deletedAt: null },
      select: { id: true, email: true, companyId: true },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
    });
    if (!employees.length) break;
    summary.scanned += employees.length;
    cursor = employees[employees.length - 1].id;
    for (const employee of employees) {
      const matches = await tx.user.findMany({
        where: {
          email: normalizeEmail(employee.email), companyId: employee.companyId, role: 'EMPLOYEE',
          status: { in: ['PENDING', 'ACTIVE'] }, deletedAt: null,
        }, select: { id: true }, take: 2,
      });
      if (!matches.length) { summary.unmatched += 1; continue; }
      if (matches.length !== 1) { summary.conflicts += 1; continue; }
      const result = await tx.employee.updateMany({
        where: { id: employee.id, companyId: employee.companyId, userId: null, deletedAt: null },
        data: { userId: matches[0].id },
      });
      if (result.count === 1) summary.linked += 1;
      else summary.conflicts += 1;
    }
    if (employees.length < 500) break;
  }
  return summary;
};
