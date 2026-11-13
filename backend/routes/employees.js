import express from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import employeeSchema, { validateEmployeeBusinessRules } from '../schemas/employeeSchema.js';
import { csvLine } from '../utils/csv.js';
import { writeAudit, actorFromReq } from '../services/auditService.js';

const router = express.Router();
router.use(authMiddleware);
router.use(rbac(['SUPER_ADMIN', 'ADMIN', 'HR']));

// Hard ceiling on list page size; REST and GraphQL agree on the maximum a request can return.
const MAX_PAGE_SIZE = 100;
const EXPORT_CHUNK = 500;
const MAX_JSON_EXPORT_ROWS = 10_000;

const formatZodErrors = (error) =>
  error.errors.reduce((acc, err) => {
    acc[err.path[0]] = err.message;
    return acc;
  }, {});

// Tenant scoping. SUPER_ADMIN may target a tenant explicitly; everyone else is pinned to their own.
// FIXED: `req.body.companyId` threw on every GET (Express 5 leaves req.body undefined).
const getTenantContext = (req, targetCompanyId = null) => {
  if (req.userRole === 'SUPER_ADMIN') {
    const companyId = targetCompanyId || req.body?.companyId || req.query?.companyId;
    return companyId ? { companyId } : {};
  }
  return { companyId: req.companyId };
};

const handleKnownErrors = (error, res) => {
  if (error instanceof z.ZodError) return res.status(400).json({ errors: formatZodErrors(error) });
  if (error.code === 'P2025') return res.status(404).json({ error: 'Employee profile not found or access denied.' });
  if (error.code === 'P2002') return res.status(409).json({ error: 'An employee with the same email, SSNIT number or Ghana Card already exists.' });
  return null;
};

// 1. List
router.get('/', async (req, res) => {
  try {
    const { search = '', active = 'true', sortBy = 'name', sortOrder = 'asc', companyId } = req.query;

    if (!req.companyId && req.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Company context missing' });
    }

    // FIXED: skip used the raw limit while take was capped, so limit>100 silently skipped records.
    const take = Math.min(Math.max(Number(req.query.limit) || 10, 1), MAX_PAGE_SIZE);
    const page = Math.max(1, Number(req.query.page) || 1);
    const skip = (page - 1) * take;

    const where = {
      ...getTenantContext(req, companyId),
      isActive: active === 'true',
      ...(search && {
        OR: [
          { name: { contains: String(search), mode: 'insensitive' } },
          { email: { contains: String(search), mode: 'insensitive' } },
          { ssnitNumber: { contains: String(search), mode: 'insensitive' } },
        ],
      }),
    };

    const validSortFields = ['name', 'email', 'basicSalary', 'createdAt'];
    const orderBy = validSortFields.includes(sortBy)
      ? { [sortBy]: sortOrder === 'desc' ? 'desc' : 'asc' }
      : { name: 'asc' };

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where, orderBy, skip, take,
        select: {
          id: true, name: true, email: true, basicSalary: true, housingAllowance: true,
          transportAllowance: true, otherAllowance: true, position: true, isActive: true,
        },
      }),
      prisma.employee.count({ where }),
    ]);

    res.json({ employees, total, page, limit: take });
  } catch (error) {
    logger.error('Employee List Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to list employees' });
  }
});

// 2. Export - genuinely streamed in chunks (the previous "chunking" accumulated every row in memory anyway)
async function* employeeChunks(where) {
  let cursor;
  for (;;) {
    const chunk = await prisma.employee.findMany({
      where,
      take: EXPORT_CHUNK,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, name: true, email: true, basicSalary: true, ssnitNumber: true, position: true },
      orderBy: { id: 'asc' },
    });
    if (!chunk.length) return;
    yield chunk;
    cursor = chunk[chunk.length - 1].id;
    if (chunk.length < EXPORT_CHUNK) return;
  }
}

router.get('/export', async (req, res) => {
  const { format = 'json', companyId } = req.query;
  try {
    const where = getTenantContext(req, companyId);
    const filePrefix = where.companyId ? `company_${where.companyId}` : 'global';
    const stamp = Date.now();
    let exported = 0;

    const audit = () =>
      writeAudit(prisma, {
        actor: actorFromReq(req),
        companyId: where.companyId ?? null,
        action: 'EMPLOYEES_EXPORTED',
        resourceType: 'Employee',
        details: { format, rows: exported },
      }).catch((e) => logger.error('AUDIT_WRITE_FAILED', { action: 'EMPLOYEES_EXPORTED', message: e.message }));

    if (format === 'csv') {
      const fields = ['name', 'email', 'position', 'basicSalary', 'ssnitNumber'];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.attachment(`employees_${filePrefix}_${stamp}.csv`);
      res.write(csvLine(fields));
      for await (const chunk of employeeChunks(where)) {
        for (const row of chunk) res.write(csvLine(fields.map((f) => (f === 'basicSalary' ? String(row[f]) : row[f]))));
        exported += chunk.length;
      }
      await audit();
      return res.end();
    }

    if (format === 'excel') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment(`employees_${filePrefix}_${stamp}.xlsx`);
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: false });
      const sheet = workbook.addWorksheet('Employees');
      sheet.columns = [
        { header: 'Full Name', key: 'name', width: 25 },
        { header: 'Email Address', key: 'email', width: 25 },
        { header: 'Position', key: 'position', width: 20 },
        { header: 'Basic Salary', key: 'basicSalary', width: 15 },
        { header: 'SSNIT Number', key: 'ssnitNumber', width: 20 },
      ];
      for await (const chunk of employeeChunks(where)) {
        for (const row of chunk) sheet.addRow({ ...row, basicSalary: Number(row.basicSalary) }).commit();
        exported += chunk.length;
      }
      sheet.commit();
      await workbook.commit();
      await audit();
      return undefined;
    }

    const all = [];
    for await (const chunk of employeeChunks(where)) {
      all.push(...chunk);
      if (all.length > MAX_JSON_EXPORT_ROWS) {
        return res.status(413).json({ error: `JSON export is limited to ${MAX_JSON_EXPORT_ROWS} rows. Use format=csv or format=excel.` });
      }
    }
    exported = all.length;
    await audit();
    return res.json(all.map((employee) => Object.fromEntries(Object.entries(employee).filter(([key]) => key !== 'id'))));
  } catch (error) {
    logger.error('Employee Export Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    if (!res.headersSent) return res.status(500).json({ error: 'Export failed' });
    return res.end();
  }
});

// 3. Create
router.post('/', async (req, res) => {
  try {
    const data = employeeSchema.parse(req.body);

    const businessRuleError = validateEmployeeBusinessRules(data);
    if (businessRuleError) return res.status(400).json({ errors: { isDisabled: businessRuleError } });

    const targetCompanyId = req.userRole === 'SUPER_ADMIN' ? req.body.companyId : req.companyId;
    if (!targetCompanyId) {
      return res.status(400).json({ error: 'companyId is required to bind this employee payload.' });
    }

    const duplicate = await prisma.employee.findFirst({ where: { email: data.email, companyId: targetCompanyId } });
    if (duplicate) return res.status(400).json({ error: 'Email already registered in this target tenant company.' });

    const employee = await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({ data: { ...data, companyId: targetCompanyId } });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId: targetCompanyId,
        action: 'EMPLOYEE_CREATED',
        resourceType: 'Employee',
        resourceId: created.id,
        details: { employeeId: created.id, basicSalary: String(created.basicSalary) },
      });
      return created;
    });

    logger.info(`Employee created: ${employee.id}`, { by: req.userId, role: req.userRole, targetCompanyId });
    res.status(201).json(employee);
  } catch (error) {
    if (handleKnownErrors(error, res)) return;
    logger.error('Employee Create Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// 4. Update
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const data = employeeSchema.partial().parse(req.body);
    const tenantCondition = getTenantContext(req);

    const existing = await prisma.employee.findFirst({ where: { id, ...tenantCondition } });
    if (!existing) return res.status(404).json({ error: 'Employee profile not found or access denied.' });

    const businessRuleError = validateEmployeeBusinessRules(data, existing);
    if (businessRuleError) return res.status(400).json({ errors: { isDisabled: businessRuleError } });

    const salaryChanged = data.basicSalary !== undefined && Number(data.basicSalary) !== Number(existing.basicSalary);

    const employee = await prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({ where: { id, ...tenantCondition }, data });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId: existing.companyId,
        action: salaryChanged ? 'EMPLOYEE_SALARY_CHANGED' : 'EMPLOYEE_UPDATED',
        resourceType: 'Employee',
        resourceId: id,
        details: {
          employeeId: id,
          changedFields: Object.keys(data),
          ...(salaryChanged ? { previousSalary: String(existing.basicSalary), newSalary: String(data.basicSalary) } : {}),
        },
      });
      return updated;
    });

    logger.info(`Employee updated: ${id}`, { by: req.userId, role: req.userRole });
    res.json(employee);
  } catch (error) {
    if (handleKnownErrors(error, res)) return;
    logger.error('Employee Update Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// 5. Soft delete (now also stamps deletedAt and is audited - previously neither)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const tenantCondition = getTenantContext(req);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id, ...tenantCondition },
        data: { isActive: false, deletedAt: new Date() },
      });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId: updated.companyId,
        action: 'EMPLOYEE_DEACTIVATED',
        resourceType: 'Employee',
        resourceId: id,
      });
    });
    logger.info(`Employee deactivated: ${id}`, { by: req.userId, role: req.userRole });
    res.json({ message: 'Employee deactivated successfully' });
  } catch (error) {
    if (handleKnownErrors(error, res)) return;
    logger.error('Employee Deactivate Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to deactivate employee' });
  }
});

export default router;
