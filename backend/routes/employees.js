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
import { findEmployeeLoginUserId } from '../services/employeeIdentityService.js';
import { buildEmployeeImportPreview, validateEmployeeImportCommitRows, EmployeeImportInputError, MAX_IMPORT_FILE_BYTES } from '../services/employeeImportService.js';
import { encryptSensitiveValue, decryptSensitiveValue } from '../services/employeePiiEncryption.js';
import { canReadEmployeeField, assertEmployeeInputPermissions, redactEmployeeForRole } from '../policies/permissions.js';

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
          { ssnitNumber: String(search) },
          { ghanaCardPin: String(search) },

        ],
      }),
    };

    const validSortFields = ['name', 'email', 'createdAt', ...(canReadEmployeeField(req.userRole, 'basicSalary') ? ['basicSalary'] : [])];
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

    res.json({ employees: employees.map((employee) => redactEmployeeForRole(employee, req.userRole)), total, page, limit: take });
  } catch (error) {
    logger.error('Employee List Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to list employees' });
  }
});

// 2. Export - genuinely streamed in chunks (the previous "chunking" accumulated every row in memory anyway)
async function* employeeChunks(where, role) {
  let cursor;
  for (;;) {
    const chunk = await prisma.employee.findMany({
      where,
      take: EXPORT_CHUNK,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, name: true, email: true, position: true,
        ...(canReadEmployeeField(role, 'basicSalary') ? { basicSalary: true } : {}),
        ...(canReadEmployeeField(role, 'ssnitNumber') ? { ssnitNumber: true } : {}),
      },
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
      const fields = ['name', 'email', 'position', ...(canReadEmployeeField(req.userRole, 'basicSalary') ? ['basicSalary'] : []), ...(canReadEmployeeField(req.userRole, 'ssnitNumber') ? ['ssnitNumber'] : [])];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.attachment(`employees_${filePrefix}_${stamp}.csv`);
      res.write(csvLine(fields));
      for await (const chunk of employeeChunks(where, req.userRole)) {
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
      for await (const chunk of employeeChunks(where, req.userRole)) {
        for (const row of chunk) sheet.addRow({ ...row, ...(row.basicSalary !== undefined ? { basicSalary: Number(row.basicSalary) } : {}) }).commit();
        exported += chunk.length;
      }
      sheet.commit();
      await workbook.commit();
      await audit();
      return undefined;
    }

    const all = [];
    for await (const chunk of employeeChunks(where, req.userRole)) {
      all.push(...chunk);
      if (all.length > MAX_JSON_EXPORT_ROWS) {
        return res.status(413).json({ error: `JSON export is limited to ${MAX_JSON_EXPORT_ROWS} rows. Use format=csv or format=excel.` });
      }
    }
    exported = all.length;
    await audit();
    return res.json(all.map((employee) => Object.fromEntries(Object.entries(redactEmployeeForRole(employee, req.userRole)).filter(([key]) => key !== 'id'))));
  } catch (error) {
    logger.error('Employee Export Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    if (!res.headersSent) return res.status(500).json({ error: 'Export failed' });
    return res.end();
  }
});

// Smart employee import: only ADMIN and SUPER_ADMIN may import compensation/identity fields.
const noStoreImportResponse = (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
};
const employeeImportPreviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many employee import previews. Try again later.' },
});
const employeeImportCommitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many employee import confirmations. Try again later.' },
});
const canImportEmployees = (role) => role === 'ADMIN' || role === 'SUPER_ADMIN';
const resolveImportCompanyId = (req) => (
  req.userRole === 'SUPER_ADMIN' ? req.body?.companyId : req.companyId
);

router.post('/import/preview', noStoreImportResponse, employeeImportPreviewLimiter, async (req, res) => {
  if (!canImportEmployees(req.userRole)) {
    return res.status(403).json({ error: 'Only company administrators can import employee records.' });
  }
  try {
    const companyId = resolveImportCompanyId(req);
    if (!companyId) return res.status(400).json({ error: 'Select a company before importing employees.' });
    const company = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!company) return res.status(404).json({ error: 'Company not found or inactive.' });

    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.slice(0, 160) : '';
    let encoded = typeof req.body?.fileBase64 === 'string' ? req.body.fileBase64.trim() : '';
    if (encoded.startsWith('data:')) encoded = encoded.slice(encoded.indexOf(',') + 1);
    if (!encoded || encoded.length > Math.ceil(MAX_IMPORT_FILE_BYTES * 4 / 3) + 8
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return res.status(400).json({ error: 'Upload a valid CSV or XLSX file no larger than 700 KB.' });
    }
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > MAX_IMPORT_FILE_BYTES
      || buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
      return res.status(400).json({ error: 'The uploaded file is invalid or exceeds the 700 KB limit.' });
    }

    const preview = await buildEmployeeImportPreview({
      fileName, buffer, companyId, client: prisma,
    });
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const created = await prisma.$transaction(async (tx) => {
      await tx.employeeImportPreview.deleteMany({
        where: { status: 'PREVIEWED', expiresAt: { lt: new Date() } },
      });
      const record = await tx.employeeImportPreview.create({
        data: {
          companyId,
          userId: req.userId,
          payloadEncrypted: encryptSensitiveValue(JSON.stringify(preview.payload)),
          rowCount: preview.response.summary.totalRows,
          expiresAt,
        },
      });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId,
        action: 'EMPLOYEE_IMPORT_PREVIEWED',
        resourceType: 'EmployeeImportPreview',
        resourceId: record.id,
        details: {
          rowCount: preview.response.summary.totalRows,
          validRows: preview.response.summary.validRows,
          invalidRows: preview.response.summary.invalidRows,
        },
      });
      return record;
    });

    return res.status(201).json({
      previewId: created.id,
      expiresAt: created.expiresAt,
      ...preview.response,
    });
  } catch (error) {
    if (error instanceof EmployeeImportInputError) return res.status(400).json({ error: error.message });
    logger.error('Employee import preview failed', { userId: req.userId, companyId: req.companyId, message: error.message });
    return res.status(500).json({ error: 'Unable to preview employee import.' });
  }
});

router.post('/import/commit', noStoreImportResponse, employeeImportCommitLimiter, async (req, res) => {
  if (!canImportEmployees(req.userRole)) {
    return res.status(403).json({ error: 'Only company administrators can import employee records.' });
  }
  const companyId = resolveImportCompanyId(req);
  const previewId = typeof req.body?.previewId === 'string' ? req.body.previewId : '';
  if (!companyId || !previewId) {
    return res.status(400).json({ error: 'A selected company and preview ID are required.' });
  }

  try {
    const company = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!company) return res.status(404).json({ error: 'Company not found or inactive.' });

    const preview = await prisma.employeeImportPreview.findFirst({
      where: {
        id: previewId, companyId, userId: req.userId,
        status: 'PREVIEWED', expiresAt: { gt: new Date() },
      },
      select: { id: true, payloadEncrypted: true, rowCount: true },
    });
    if (!preview) return res.status(410).json({ error: 'This import preview has expired or is no longer available. Upload the file again.' });

    const payload = JSON.parse(decryptSensitiveValue(preview.payloadEncrypted));
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.employeeImportPreview.updateMany({
        where: {
          id: preview.id, companyId, userId: req.userId,
          status: 'PREVIEWED', expiresAt: { gt: new Date() },
        },
        data: { status: 'IMPORTING' },
      });
      if (claim.count !== 1) {
        const error = new Error('This import preview has already been used or expired.');
        error.code = 'IMPORT_PREVIEW_UNAVAILABLE';
        throw error;
      }

      const rows = await validateEmployeeImportCommitRows({
        rows: payload.rows, companyId, client: tx,
      });
      const createdEmployees = [];
      for (const row of rows) {
        const employeeUserId = await findEmployeeLoginUserId(tx, {
          email: row.data.email, companyId,
        });
        const created = await tx.employee.create({
          data: {
            ...row.data,
            companyId,
            ...(employeeUserId ? { userId: employeeUserId } : {}),
          },
          select: { id: true },
        });
        createdEmployees.push(created.id);
      }

      // The encrypted staged payload is deleted after a successful import; only the audit summary remains.
      await tx.employeeImportPreview.delete({ where: { id: preview.id } });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId,
        action: 'EMPLOYEES_IMPORTED',
        resourceType: 'EmployeeImportPreview',
        resourceId: preview.id,
        details: {
          importedCount: createdEmployees.length,
          skippedInvalidCount: payload.rows.length - createdEmployees.length,
        },
      });
      return {
        importedCount: createdEmployees.length,
        skippedInvalidCount: payload.rows.length - createdEmployees.length,
      };
    }, { isolationLevel: 'Serializable' });

    return res.json({ message: 'Employee import completed.', ...result });
  } catch (error) {
    if (error.code === 'IMPORT_NO_VALID_ROWS') return res.status(400).json({ error: error.message });
    if (error.code === 'IMPORT_DUPLICATES_CHANGED' || error.code === 'P2002' || error.code === 'P2034') {
      return res.status(409).json({ error: error.message || 'An employee record now conflicts with an existing employee. Generate a new preview.' });
    }
    if (error.code === 'IMPORT_PREVIEW_UNAVAILABLE') return res.status(409).json({ error: error.message });
    logger.error('Employee import commit failed', { userId: req.userId, companyId, code: error.code, message: error.message });
    return res.status(500).json({ error: 'Employee import failed. Generate a new preview and try again.' });
  }
});

// 3. Create
router.post('/', async (req, res) => {
  try {
    const data = employeeSchema.parse(req.body);
    if (req.userRole === 'HR') {
      const fields = { ...req.body };
      for (const field of ['basicSalary', 'housingAllowance', 'transportAllowance', 'otherAllowance', 'allowances']) delete fields[field];
      if (!assertEmployeeInputPermissions(req.userRole, fields)) return res.status(403).json({ error: 'HR cannot create employee bank details.' });
    }

    const businessRuleError = validateEmployeeBusinessRules(data);
    if (businessRuleError) return res.status(400).json({ errors: { isDisabled: businessRuleError } });

    const targetCompanyId = req.userRole === 'SUPER_ADMIN' ? req.body.companyId : req.companyId;
    if (!targetCompanyId) {
      return res.status(400).json({ error: 'companyId is required to bind this employee payload.' });
    }

    const duplicate = await prisma.employee.findFirst({ where: { email: data.email, companyId: targetCompanyId } });
    if (duplicate) return res.status(400).json({ error: 'Email already registered in this target tenant company.' });

    const employee = await prisma.$transaction(async (tx) => {
      const employeeUserId = await findEmployeeLoginUserId(tx, { email: data.email, companyId: targetCompanyId });
      const created = await tx.employee.create({
        data: { ...data, companyId: targetCompanyId, ...(employeeUserId ? { userId: employeeUserId } : {}) },
      });
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
    res.status(201).json(redactEmployeeForRole(employee, req.userRole));
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

    const changedFields = Object.fromEntries(Object.entries(data).filter(([field, value]) => String(value ?? '') !== String(existing[field] ?? '')));
    if (data.isActive === false) data.deletedAt = existing.deletedAt || new Date();
    if (data.isActive === true) data.deletedAt = null;
    if (!assertEmployeeInputPermissions(req.userRole, changedFields)) return res.status(403).json({ error: 'You do not have permission to change one or more sensitive employee fields.' });

    const businessRuleError = validateEmployeeBusinessRules(data, existing);
    if (businessRuleError) return res.status(400).json({ errors: { isDisabled: businessRuleError } });

    const salaryChanged = data.basicSalary !== undefined && Number(data.basicSalary) !== Number(existing.basicSalary);

    const employee = await prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({ where: { id, ...tenantCondition }, data });
      await writeAudit(tx, {
        actor: actorFromReq(req),
        companyId: existing.companyId,
        action: data.isActive === false && existing.isActive ? 'EMPLOYEE_DEACTIVATED' : data.isActive === true && !existing.isActive ? 'EMPLOYEE_REACTIVATED' : salaryChanged ? 'EMPLOYEE_SALARY_CHANGED' : 'EMPLOYEE_UPDATED',
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
    res.json(redactEmployeeForRole(employee, req.userRole));
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
