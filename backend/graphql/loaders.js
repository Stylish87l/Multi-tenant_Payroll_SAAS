import DataLoader from 'dataloader';
import prisma, { Prisma } from '../config/db.js';

/**
 * Every GraphQL request receives fresh loaders bound to its authenticated tenant.
 * Non-platform callers fail closed when tenant context is missing.
 */
export const createLoaders = ({ companyId = null, userRole = null } = {}) => {
  const platform = userRole === 'SUPER_ADMIN';
  const tenantId = platform ? null : (companyId || '__unauthenticated__');
  return {
    company: new DataLoader(async (ids) => {
      const companies = await prisma.company.findMany({
        where: { AND: [{ id: { in: [...new Set(ids)] } }, ...(platform ? [] : [{ id: tenantId }])] },
      });
      const map = new Map(companies.map((company) => [company.id, company]));
      return ids.map((id) => map.get(id) || null);
    }),
    payrollRunLoader: new DataLoader(async (runIds) => {
      const runs = await prisma.payrollRun.findMany({
        where: { id: { in: [...new Set(runIds)] }, ...(platform ? {} : { companyId: tenantId }) },
      });
      const map = new Map(runs.map((run) => [run.id, run]));
      return runIds.map((id) => map.get(id) || null);
    }),
    payrollRunTotalLoader: new DataLoader(async (runIds) => {
      const rows = await prisma.payrollItem.groupBy({
        by: ['payrollRunId'],
        where: {
          payrollRunId: { in: [...new Set(runIds)] },
          ...(platform ? {} : { payrollRun: { companyId: tenantId } }),
        },
        _sum: { netPay: true },
      });
      const map = new Map(rows.map((row) => [row.payrollRunId, row._sum.netPay]));
      return runIds.map((id) => map.get(id) ?? new Prisma.Decimal(0));
    }),
    payrollItemsByRunLoader: new DataLoader(async (runIds) => {
      const items = await prisma.payrollItem.findMany({
        where: {
          payrollRunId: { in: [...new Set(runIds)] },
          ...(platform ? {} : { payrollRun: { companyId: tenantId } }),
        },
        include: { employee: true },
      });
      const map = new Map();
      for (const item of items) {
        if (!map.has(item.payrollRunId)) map.set(item.payrollRunId, []);
        map.get(item.payrollRunId).push(item);
      }
      return runIds.map((id) => map.get(id) || []);
    }),
  };
};
