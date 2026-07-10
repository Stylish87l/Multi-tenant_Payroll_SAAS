import express from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { AsyncParser } from 'json2csv'; // Memory-safe streaming parser alternative
import ExcelJS from 'exceljs';
import employeeSchema from '../schemas/employeeSchema.js';

const router = express.Router();
router.use(authMiddleware);
router.use(rbac(['SUPER_ADMIN', 'ADMIN', 'HR']));

const formatZodErrors = (error) => {
  return error.errors.reduce((acc, err) => {
    acc[err.path[0]] = err.message;
    return acc;
  }, {});
};

// Helper: Establish secure scoping rules depending on role context
const getTenantContext = (req, targetCompanyId = null) => {
  if (req.userRole === 'SUPER_ADMIN') {
    // If super admin passes a specific tenant context, enforce it. Otherwise, drop constraint.
    const companyId = targetCompanyId || req.body.companyId || req.query.companyId;
    return companyId ? { companyId } : {};
  }
  return { companyId: req.companyId };
};

// 1. List Employees
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', active = 'true', sortBy = 'name', sortOrder = 'asc', companyId } = req.query;
    
    if (!req.companyId && req.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Company context missing' });
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const take = Math.min(Number(limit), 100);

    const where = {
      ...getTenantContext(req, companyId),
      isActive: active === 'true',
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { ssnitNumber: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const validSortFields = ['name', 'email', 'basicSalary', 'createdAt'];
    const orderBy = validSortFields.includes(sortBy) 
      ? { [sortBy]: sortOrder === 'desc' ? 'desc' : 'asc' } 
      : { name: 'asc' };

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy,
        skip,
        take,
        select: { id: true, name: true, email: true, basicSalary: true, position: true, isActive: true },
      }),
      prisma.employee.count({ where }),
    ]);

    res.json({ employees, total, page: Number(page), limit: take });
  } catch (error) {
    logger.error('Employee List Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to list employees' });
  }
});

// 2. Export (Optimized with Batch Chunks)
router.get('/export', async (req, res) => {
  const { format = 'json', companyId } = req.query;
  try {
    const where = getTenantContext(req, companyId);

    // Using Chunking/Batching to prevent running out of V8 Heap RAM
    const CHUNK_SIZE = 500;
    let skip = 0;
    let hasMore = true;
    let allEmployees = [];

    while (hasMore) {
      const chunk = await prisma.employee.findMany({
        where,
        skip,
        take: CHUNK_SIZE,
        select: { name: true, email: true, basicSalary: true, ssnitNumber: true, position: true },
        orderBy: { id: 'asc' }
      });

      allEmployees.push(...chunk);
      skip += CHUNK_SIZE;
      if (chunk.length < CHUNK_SIZE) hasMore = false;
    }

    const filePrefix = where.companyId ? `company_${where.companyId}` : 'global';

    if (format === 'csv') {
      const fields = ['name', 'email', 'position', 'basicSalary', 'ssnitNumber'];
      const transformOpts = { highWaterMark: 16384, encoding: 'utf-8' };
      const asyncParser = new AsyncParser({ fields }, transformOpts);
      
      const csv = await asyncParser.parse(allEmployees).promise();
      res.setHeader('Content-Type', 'text/csv');
      res.attachment(`employees_${filePrefix}_${Date.now()}.csv`);
      return res.send(csv);
    }

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Employees');
      
      sheet.columns = [
        { header: 'Full Name', key: 'name', width: 25 },
        { header: 'Email Address', key: 'email', width: 25 },
        { header: 'Position', key: 'position', width: 20 },
        { header: 'Basic Salary', key: 'basicSalary', width: 15 },
        { header: 'SSNIT Number', key: 'ssnitNumber', width: 20 },
      ];

      sheet.addRows(allEmployees);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment(`employees_${filePrefix}_${Date.now()}.xlsx`);
      
      await workbook.xlsx.write(res);
      return res.end();
    }

    res.json(allEmployees);
  } catch (error) {
    logger.error('Employee Export Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Export failed' });
  }
});

// 3. Create
router.post('/', async (req, res) => {
  try {
    const data = employeeSchema.parse(req.body);
    
    // Dynamically choose target tenant domain
    const targetCompanyId = req.userRole === 'SUPER_ADMIN' ? req.body.companyId : req.companyId;
    if (!targetCompanyId) {
      return res.status(400).json({ error: 'companyId is required to bind this employee payload.' });
    }

    const duplicate = await prisma.employee.findFirst({
      where: { email: data.email, companyId: targetCompanyId }
    });
    if (duplicate) return res.status(400).json({ error: 'Email already registered in this target tenant company.' });

    const employee = await prisma.employee.create({
      data: { ...data, companyId: targetCompanyId },
    });

    logger.info(`Employee created: ${employee.id} by User: ${req.userId}`, { role: req.userRole, targetCompanyId });
    res.status(201).json(employee);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: formatZodErrors(error) });
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

    // Super Admin can run updates globally across any record id; regular tenants are constrained
    const employee = await prisma.employee.update({
      where: { id, ...tenantCondition },
      data,
    });

    logger.info(`Employee updated: ${id} by User: ${req.userId}`, { role: req.userRole });
    res.json(employee);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: formatZodErrors(error) });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Employee profile not found or access denied.' });
    logger.error('Employee Update Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// 5. Soft Delete
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const tenantCondition = getTenantContext(req);

    await prisma.employee.update({
      where: { id, ...tenantCondition },
      data: { isActive: false },
    });
    logger.info(`Employee deactivated: ${id} by User: ${req.userId}`, { role: req.userRole });
    res.json({ message: 'Employee deactivated successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Employee profile not found or access denied.' });
    logger.error('Employee Deactivate Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to deactivate employee' });
  }
});

export default router;