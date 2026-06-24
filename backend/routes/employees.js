import express from 'express';
import { z } from 'zod';
import prisma from '../config/db.js';
import authMiddleware from '../middleware/auth.js';
import rbac from '../middleware/rbac.js';
import logger from '../config/logger.js';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';

const router = express.Router();
router.use(authMiddleware);
// Allow SUPER_ADMIN globally, plus tenant ADMIN and HR
router.use(rbac(['SUPER_ADMIN', 'ADMIN', 'HR']));

// 2026 Ghana Compliance Schema
const employeeSchema = z.object({
  name: z.string().trim().min(2, 'Name too short'),
  email: z.string().email('Invalid email').transform((val) => val.toLowerCase()),
  ghanaCardPin: z.string().regex(/^GHA-\d{9}-\d{1}$/, 'Invalid Ghana Card PIN (Format: GHA-123456789-1)'),
  ssnitNumber: z.string().length(13, 'SSNIT must be 13 characters'),
  basicSalary: z.number().positive('Salary must be positive'),
  housingAllowance: z.number().nonnegative().default(0),
  transportAllowance: z.number().nonnegative().default(0),
  otherAllowance: z.number().nonnegative().default(0),
  isMarried: z.boolean().default(false),
  hasResponsibility: z.boolean().default(false),
  childrenCount: z.number().int().min(0).max(3).default(0),
  isDisabled: z.boolean().default(false),
  agedDependentsCount: z.number().int().min(0).max(2).default(0),
  age: z.number().int().min(18).max(70).default(30),
  position: z.string().min(2, 'Position required'),
  bankName: z.string().min(2, 'Bank name required'),
  bankAccount: z.string().regex(/^\d{5,20}$/, 'Invalid account number'),
  isActive: z.boolean().default(true),
});

// Helper: Format Zod Errors for Frontend
const formatZodErrors = (error) => {
  return error.errors.reduce((acc, err) => {
    acc[err.path[0]] = err.message;
    return acc;
  }, {});
};

// 1. List Employees
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', active = 'true', sortBy = 'name', sortOrder = 'asc' } = req.query;
    
    if (!req.companyId && req.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Company context missing' });
    }

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const take = Math.min(Number(limit), 100);

    const where = {
      ...(req.userRole !== 'SUPER_ADMIN' && { companyId: req.companyId }),
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

// 2. Export
router.get('/export', async (req, res) => {
  const { format = 'json' } = req.query;
  try {
    const employees = await prisma.employee.findMany({
      where: req.userRole === 'SUPER_ADMIN' ? {} : { companyId: req.companyId },
      select: { name: true, email: true, basicSalary: true, ssnitNumber: true, position: true },
    });

    if (format === 'csv') {
      const parser = new Parser();
      const csv = parser.parse(employees);
      res.setHeader('Content-Type', 'text/csv');
      res.attachment(`employees_export_${Date.now()}.csv`);
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

      sheet.addRows(employees);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment(`employees_export_${Date.now()}.xlsx`);
      
      await workbook.xlsx.write(res);
      return res.end();
    }

    res.json(employees);
  } catch (error) {
    logger.error('Employee Export Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Export failed' });
  }
});

// 3. Create
router.post('/', async (req, res) => {
  try {
    const data = employeeSchema.parse(req.body);
    
    const duplicate = await prisma.employee.findFirst({
      where: { email: data.email, companyId: req.companyId }
    });
    if (duplicate) return res.status(400).json({ error: 'Email already registered in your company' });

    const employee = await prisma.employee.create({
      data: { ...data, companyId: req.companyId },
    });

    logger.info(`Employee created: ${employee.id} by User: ${req.userId}`, { role: req.userRole });
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

    const employee = await prisma.employee.update({
      where: { id, companyId: req.companyId },
      data,
    });

    logger.info(`Employee updated: ${id} by User: ${req.userId}`, { role: req.userRole });
    res.json(employee);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ errors: formatZodErrors(error) });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Employee not found' });
    logger.error('Employee Update Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// 5. Soft Delete
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.employee.update({
      where: { id, companyId: req.companyId },
      data: { isActive: false },
    });
    logger.info(`Employee deactivated: ${id} by User: ${req.userId}`, { role: req.userRole });
    res.json({ message: 'Employee deactivated successfully' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Employee not found' });
    logger.error('Employee Deactivate Error', { companyId: req.companyId, role: req.userRole, stack: error.stack });
    res.status(500).json({ error: 'Failed to deactivate employee' });
  }
});

export default router;
