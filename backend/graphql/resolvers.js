import { PubSub, withFilter } from 'graphql-subscriptions';
import DataLoader from 'dataloader';
import bcrypt from 'bcrypt';
import { processPayout as processPayoutService } from '../services/paymentServices.js';
import crypto from 'crypto';
import prisma from '../config/db.js';
import logger from '../config/logger.js';
import {
  signAccessToken,
  signRefreshToken,
  generateRandomToken,
  hashToken,
  computeExpiryDate,
} from '../utils/authTokens.js';
import { REFRESH_COOKIE_NAME, getRefreshCookieOptions } from '../config/cookies.js';
import { calculateSSNIT } from '../utils/ssnitCalculator.js';
import { calculatePAYE } from '../utils/payeCalculator.js';
import notificationSchema from '../schemas/notificationSchema.js';

// Real-time engine
const pubsub = new PubSub();

// FIXED: GraphQL mutations had zero role enforcement - any authenticated
// user (including EMPLOYEE) could call createEmployee/runPayroll/etc
// directly, even though the equivalent REST routes are RBAC-protected.
// This mirrors middleware/rbac.js's allow-list check for use inside resolvers.
const requireRole = (userRole, allowedRoles, action = 'perform this action') => {
  if (!userRole || !allowedRoles.includes(userRole)) {
    throw new Error(`Unauthorized: You do not have permission to ${action}`);
  }
};

// Roles permitted to see payroll FINANCIAL data (gross/net/tax figures).
// Mirrors frontend/src/config/sidebarConfig.js's "Payroll" and "Reports"
// nav entries exactly, so REST, GraphQL, and the UI's own navigation guard
// all agree on who can see money. HR is intentionally excluded here (HR
// manages employee records, not disbursement figures) - same
// segregation-of-duties reasoning applied to routes/payroll.js.
const PAYROLL_FINANCE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];

const resolvers = {
  Query: {
    me: async (_, __, { userId }) => {
      logger.info('Query.me called', { userId });
      try {
        if (!userId) {
          logger.warn('Query.me: No userId in context');
          return null;
        }
        const user = await prisma.user.findUnique({ 
          where: { id: userId },
          include: { company: true } 
        });
        logger.info('Query.me success', { userId, found: !!user });
        return user;
      } catch (error) {
        logger.error('Query.me Error', { userId, message: error.message, stack: error.stack });
        throw new Error('Failed to fetch user profile');
      }
    },

    /**
     * FIXED (2026-07-10): This resolver previously existed TWICE, both
     * copies pasted OUTSIDE the `resolvers` object entirely (after the
     * closing `};`), as bare `companies: async (...) => {...},` module-level
     * statements. That is not valid JavaScript at the top level of a
     * module - `companies:` parses as a label, the arrow function as an
     * unused expression statement, and the trailing `,` after it is an
     * outright SyntaxError. The entire file failed to import, which means
     * the whole Express/Apollo server crashed before it could ever call
     * httpServer.listen(). This is the actual root cause of the Railway
     * 502s - the process was never binding to a port at all, so every
     * downstream CORS/health diagnostic was chasing a symptom, not the
     * cause. Moved here, deduplicated, and now correctly gated to
     * SUPER_ADMIN only, matching typeDefs.js's doc comment.
     */
    companies: async (_, __, { userRole }) => {
      requireRole(userRole, ['SUPER_ADMIN'], 'view the tenant directory');
      try {
        return await prisma.company.findMany({
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            tin: true,
            address: true,
            themeColor: true,
            logoUrl: true,
            footerNote: true,
            payslipTemplate: true,
            createdBy: true,
            createdAt: true,
          },
        });
      } catch (error) {
        logger.error('Query.companies Error', { message: error.message, stack: error.stack });
        throw new Error('Failed to fetch tenant list');
      }
    },

    employees: async (_, { page = 1, limit = 10, search, companyId: argCompanyId }, { companyId: ctxCompanyId, userRole }) => {
      logger.info('Query.employees called', { page, limit, ctxCompanyId, userRole });
      try {
        // FIXED: REST employees.js restricts the entire router to
        // SUPER_ADMIN/ADMIN/HR - GraphQL had no equivalent check.
        requireRole(userRole, ['SUPER_ADMIN', 'ADMIN', 'HR'], 'view employee records');

        const effectiveCompanyId = userRole === 'SUPER_ADMIN' ? argCompanyId : ctxCompanyId;

        if (!effectiveCompanyId && userRole !== 'SUPER_ADMIN') {
          logger.warn('Query.employees unauthorized', { effectiveCompanyId, userRole });
          throw new Error('Unauthorized: No company context');
        }

        const skip = Math.max(0, (page - 1) * limit);

        const where = {
          AND: [
            userRole === 'SUPER_ADMIN' && !argCompanyId ? {} : { companyId: effectiveCompanyId },
            search ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { position: { contains: search, mode: 'insensitive' } }
              ]
            } : {}
          ]
        };

        const [items, total] = await Promise.all([
          prisma.employee.findMany({
            where,
            skip,
            take: limit,
            orderBy: { name: 'asc' },
            include: { company: true }
          }),
          prisma.employee.count({ where })
        ]);

        logger.info('Query.employees success', { count: items.length, total });

        return {
          items,
          total, 
          page,
          limit,
          pageInfo: {
            hasNextPage: skip + items.length < total,
            endCursor: items.length > 0 ? items[items.length - 1].id : null
          }
        };
      } catch (error) {
        logger.error('Query.employees Error', { ctxCompanyId, role: userRole, message: error.message, stack: error.stack });
        if (process.env.NODE_ENV === 'development') throw error;
        throw new Error('Failed to fetch employees');
      }
    },

    employeeCount: async (_, { companyId: argId }, { companyId: ctxId, userRole }) => {
      const targetId = userRole === 'SUPER_ADMIN' ? argId : ctxId;

      if (!targetId && userRole !== 'SUPER_ADMIN') {
        logger.warn('Query.employeeCount unauthorized: no company context', { userRole });
        throw new Error('Unauthorized: No company context');
      }

      if (!targetId && userRole === 'SUPER_ADMIN') {
        logger.info('Query.employeeCount: SUPER_ADMIN global count requested');
        return prisma.employee.count();
      }

      return prisma.employee.count({ where: { companyId: targetId } });
    },

    recentPayrollRuns: async (_, { companyId: argId, limit = 5 }, { companyId: ctxId, userRole }) => {
      if (!PAYROLL_FINANCE_ROLES.includes(userRole)) {
        logger.info('Query.recentPayrollRuns: scoped to empty result for restricted role', { userRole });
        return [];
      }

      const targetId = userRole === 'SUPER_ADMIN' ? argId : ctxId;
      if (!targetId && userRole !== 'SUPER_ADMIN') {
        throw new Error('Unauthorized: No company context');
      }

      return prisma.payrollRun.findMany({
        where: targetId ? { companyId: targetId } : {},
        take: limit,
        orderBy: { createdAt: 'desc' },
      });
    },

    pendingNotifications: async (_, { userId: argId }, { userId: ctxId }) => {
      return prisma.notification.count({ 
        where: { userId: argId || ctxId, status: 'PENDING' } 
      });
    },

    payrollRuns: async (_, { page = 1, limit = 10, companyId: argId }, { companyId: ctxId, userRole }) => {
      logger.info('Query.payrollRuns called', { page, limit, ctxId, userRole });
      try {
        requireRole(userRole, PAYROLL_FINANCE_ROLES, 'view payroll runs');

        const targetId = userRole === 'SUPER_ADMIN' ? argId : ctxId;
        if (!targetId && userRole !== 'SUPER_ADMIN') {
          throw new Error('Unauthorized: No company context');
        }

        const skip = Math.max(0, (page - 1) * limit);
        const where = targetId ? { companyId: targetId } : {};

        const [items, total] = await Promise.all([
          prisma.payrollRun.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
          }),
          prisma.payrollRun.count({ where })
        ]);

        return {
          items,
          total,
          page,
          limit,
          pageInfo: {
            hasNextPage: skip + items.length < total,
            endCursor: items.length > 0 ? items[items.length - 1].id : null
          }
        };
      } catch (error) {
        logger.error('Query.payrollRuns Error', { message: error.message, stack: error.stack });
        if (error.message?.startsWith('Unauthorized')) throw error;
        if (process.env.NODE_ENV === 'development') throw error;
        throw new Error('Failed to fetch payroll runs');
      }
    },

    payrollRun: async (_, { id }, { companyId, userRole }) => {
      logger.info('Query.payrollRun called', { id, companyId, userRole });
      try {
        requireRole(userRole, PAYROLL_FINANCE_ROLES, 'view payroll run details');

        const run = await prisma.payrollRun.findFirst({
          where: userRole === 'SUPER_ADMIN' ? { id } : { id, companyId },
          include: { items: { include: { employee: true } } }
        });
        if (!run) throw new Error('Payroll run not found or access denied');
        return run;
      } catch (error) {
        logger.error('Query.payrollRun Error', { id, message: error.message, stack: error.stack });
        throw error;
      }
    },

    notifications: async (_, { page = 1, limit = 10 }, { companyId, userRole, userId }) => {
      logger.info('Query.notifications called', { userId });
      try {
        const skip = Math.max(0, (page - 1) * limit);
        const notifications = await prisma.notification.findMany({
          where: { userId },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        });
        return notifications;
      } catch (error) {
        logger.error('Query.notifications Error', { message: error.message, stack: error.stack });
        throw new Error('Failed to fetch notifications');
      }
    },

    payrollSummaryReport: async (_, { companyId: argId, month }, { companyId: ctxId, userRole }) => {
      requireRole(userRole, PAYROLL_FINANCE_ROLES, 'view payroll summary reports');

      const targetId = userRole === 'SUPER_ADMIN' ? (argId || ctxId) : ctxId;
      if (!targetId) throw new Error('Unauthorized: No company context');

      try {
        const where = {
          payrollRun: { companyId: targetId, ...(month ? { month } : {}) },
        };

        const [aggregate, employeeCount] = await Promise.all([
          prisma.payrollItem.aggregate({
            where,
            _sum: { grossSalary: true, payeTax: true, ssnitEmployee: true, netPay: true },
          }),
          prisma.payrollItem.count({ where }),
        ]);

        return {
          totalGross: aggregate._sum.grossSalary || 0,
          totalPAYE: aggregate._sum.payeTax || 0,
          totalSSNIT: aggregate._sum.ssnitEmployee || 0,
          totalNetPay: aggregate._sum.netPay || 0,
          employeeCount,
        };
      } catch (error) {
        logger.error('Query.payrollSummaryReport Error', { targetId, month, message: error.message, stack: error.stack });
        if (error.message?.startsWith('Unauthorized')) throw error;
        throw new Error('Failed to generate payroll summary report');
      }
    },

    preferences: async (_, __, { userId }) => {
      if (!userId) return null;
      try {
        let prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
        if (!prefs) {
          prefs = await prisma.notificationPreference.create({ data: { userId } });
        }
        return prefs;
      } catch (error) {
        logger.error('Query.preferences Error', { userId, message: error.message, stack: error.stack });
        throw new Error('Failed to fetch preferences');
      }
    },
  },

  Mutation: {
    register: async (_, { email, password, name, companyName }) => {
      logger.info('Mutation.register called', { email });
      try {
        const normalizedEmail = email?.toLowerCase().trim();
        const existingUser = await prisma.user.findFirst({ where: { email: normalizedEmail } });
        if (existingUser) throw new Error('User with this email already exists');

        const hashedPassword = await bcrypt.hash(password, 12);

        const result = await prisma.$transaction(async (tx) => {
          const company = await tx.company.create({
            data: { name: companyName || `${name}'s Org` },
          });

          const user = await tx.user.create({
            data: {
              email: normalizedEmail,
              name,
              password: hashedPassword,
              role: 'ADMIN',
              companyId: company.id,
              status: 'ACTIVE',
            },
          });
          return { user, company };
        });

        const accessToken = signAccessToken({
          userId: result.user.id,
          companyId: result.company.id,
          role: result.user.role,
          email: result.user.email,
        });

        return { accessToken, user: result.user, companyId: result.company.id };
      } catch (error) {
        logger.error('Mutation.register Error', { email, message: error.message, stack: error.stack });
        throw error;
      }
    },

    login: async (_, { email, password }, { res, req }) => {
      logger.info('Mutation.login called', { email });
      try {
        const normalizedEmail = email?.toLowerCase().trim();
        const user = await prisma.user.findFirst({ where: { email: normalizedEmail } });
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
          throw new Error('Invalid email or password');
        }

        if (user.status !== 'ACTIVE') throw new Error('Account is suspended');

        const accessToken = signAccessToken({
          userId: user.id,
          companyId: user.role === 'SUPER_ADMIN' ? null : user.companyId,
          role: user.role,
          email: user.email,
        });

        const tokenId = crypto.randomUUID();
        const refreshToken = signRefreshToken({ userId: user.id, tokenId });

        await prisma.refreshToken.create({
          data: {
            userId: user.id,
            tokenId,
            expiresAt: computeExpiryDate(),
            deviceInfo: req?.get('User-Agent') || null,
            ipAddress: req?.ip || null,
          },
        });

        if (res && typeof res.cookie === 'function') {
          res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
          logger.info('HttpOnly refresh cookie set', { userId: user.id });
        } else {
          logger.warn('Mutation.login: res unavailable in context, refresh cookie NOT set', {
            userId: user.id,
          });
        }

        return {
          accessToken,
          companyId: user.companyId || null,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            status: user.status,
            companyId: user.companyId,
          },
        };
      } catch (error) {
        logger.error('Mutation.login Error', { email, message: error.message, stack: error.stack });
        throw error;
      }
    },

    createEmployee: async (_, { input }, { companyId, userRole }) => {
      logger.info('Mutation.createEmployee called', { input, companyId });
      try {
        requireRole(userRole, ['SUPER_ADMIN', 'ADMIN', 'HR'], 'create employee records');

        const targetCompanyId = userRole === 'SUPER_ADMIN' ? (input.companyId || companyId) : companyId;
        if (!targetCompanyId) throw new Error('Unauthorized: No company context');

        const employee = await prisma.employee.create({
          data: {
            name: input.name,
            email: input.email.toLowerCase().trim(),
            basicSalary: input.basicSalary,
            otherAllowance: input.allowances || 0,
            position: input.position,
            ghanaCardPin: input.ghanaCardPIN || input.ghanaCardPin || null,
            ssnitNumber: input.ssnitNumber || null,
            companyId: targetCompanyId,
            isActive: true,
            bankName: input.bankName ?? undefined,
            bankAccount: input.bankAccount ?? undefined,
            age: input.age ?? undefined,
            isMarried: input.isMarried ?? undefined,
            hasResponsibility: input.hasResponsibility ?? undefined,
            childrenCount: input.childrenCount ?? undefined,
            isDisabled: input.isDisabled ?? undefined,
            agedDependentsCount: input.agedDependentsCount ?? undefined,
          },
        });
        return employee;
      } catch (error) {
        logger.error('Mutation.createEmployee Error', { message: error.message, stack: error.stack });
        throw error;
      }
    },

    updateEmployee: async (_, { id, input }, { companyId, userRole }) => {
      logger.info('Mutation.updateEmployee called', { id, input, companyId });
      try {
        requireRole(userRole, ['SUPER_ADMIN', 'ADMIN', 'HR'], 'update employee records');

        const existingEmployee = await prisma.employee.findUnique({
          where: { id }
        });

        if (!existingEmployee) {
          throw new Error('Employee not found');
        }

        if (userRole !== 'SUPER_ADMIN' && existingEmployee.companyId !== companyId) {
          logger.warn('Unauthorized update attempt', { employeeId: id, companyId });
          throw new Error('Unauthorized: You do not own this record');
        }

        const updatedEmployee = await prisma.employee.update({
          where: { id },
          data: {
            name: input.name,
            email: input.email ? input.email.toLowerCase().trim() : undefined,
            basicSalary: input.basicSalary,
            otherAllowance: input.allowances,
            position: input.position,
            ghanaCardPin: input.ghanaCardPIN !== undefined ? input.ghanaCardPIN : (input.ghanaCardPin !== undefined ? input.ghanaCardPin : undefined),
            ssnitNumber: input.ssnitNumber,
            isActive: input.isActive,
            bankName: input.bankName,
            bankAccount: input.bankAccount,
            age: input.age,
            isMarried: input.isMarried,
            hasResponsibility: input.hasResponsibility,
            childrenCount: input.childrenCount,
            isDisabled: input.isDisabled,
            agedDependentsCount: input.agedDependentsCount,
          },
        });

        return updatedEmployee;
      } catch (error) {
        logger.error('Mutation.updateEmployee Error', { id, message: error.message, stack: error.stack });
        throw error;
      }
    },

    runPayroll: async (_, { month, companyId: argId }, { companyId: ctxId, userRole, userId }) => {
      logger.info('Mutation.runPayroll called', { month, argId });
      requireRole(userRole, ['SUPER_ADMIN', 'ADMIN', 'HR'], 'run payroll');

      const targetId = userRole === 'SUPER_ADMIN' ? (argId || ctxId) : ctxId;
      if (!targetId) {
        throw new Error('Unauthorized: No company context for payroll run');
      }

      const normalizedMonth = /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedMonth)) {
        throw new Error('Invalid month format. Expected YYYY-MM or YYYY-MM-DD.');
      }

      try {
        const existing = await prisma.payrollRun.findFirst({
          where: { companyId: targetId, month: normalizedMonth },
        });
        if (existing) {
          throw new Error(`Payroll for ${normalizedMonth} already exists for this company.`);
        }

        const employees = await prisma.employee.findMany({
          where: { companyId: targetId, isActive: true },
          select: {
            id: true,
            basicSalary: true,
            housingAllowance: true,
            transportAllowance: true,
            otherAllowance: true,
            isMarried: true,
            hasResponsibility: true,
            childrenCount: true,
            isDisabled: true,
            age: true,
            agedDependentsCount: true,
          },
        });

        if (!employees.length) {
          throw new Error('No active employees found for this company.');
        }

        const computedItems = [];
        for (const emp of employees) {
          const basicSalary = Number(emp.basicSalary);
          const totalAllowances =
            Number(emp.housingAllowance) + Number(emp.transportAllowance) + Number(emp.otherAllowance);
          const grossSalary = basicSalary + totalAllowances;

          // eslint-disable-next-line no-await-in-loop
          const ssnit = await calculateSSNIT(basicSalary, totalAllowances, targetId);
          const assessableIncome = grossSalary - ssnit.employeeDeduction;

          // eslint-disable-next-line no-await-in-loop
          const paye = await calculatePAYE(
            assessableIncome,
            {
              isMarried: emp.isMarried,
              hasResponsibility: emp.hasResponsibility,
              childrenCount: emp.childrenCount,
              isDisabled: emp.isDisabled,
              age: emp.age,
              agedDependentsCount: emp.agedDependentsCount,
            },
            targetId,
            0,
            0,
            basicSalary
          );

          computedItems.push({
            employeeId: emp.id,
            grossSalary,
            taxableIncome: paye.taxableIncome,
            ssnitEmployee: ssnit.employeeDeduction,
            ssnitEmployer: ssnit.employerContribution,
            ssnitTier1: ssnit.remittance.tier1,
            ssnitTier2: ssnit.remittance.tier2,
            payeTax: paye.totalTax,
            netPay: grossSalary - ssnit.employeeDeduction - paye.totalTax,
          });
        }

        const payrollRun = await prisma.$transaction(async (tx) => {
          const run = await tx.payrollRun.create({
            data: {
              companyId: targetId,
              month: normalizedMonth,
              status: 'DRAFT',
              runType: 'REGULAR',
              processedById: userId || null,
            },
          });

          await tx.payrollItem.createMany({
            data: computedItems.map((item) => ({ ...item, payrollRunId: run.id })),
          });

          await tx.auditLog.create({
            data: {
              userId: userId || null,
              companyId: targetId,
              action: 'PAYROLL_RUN_CREATED',
              details: {
                runId: run.id,
                companyId: targetId,
                month: normalizedMonth,
                employeeCount: computedItems.length,
              },
              resourceId: run.id,
              resourceType: 'PayrollRun',
            },
          });

          return run;
        });

        pubsub.publish('PAYROLL_UPDATED', { payrollUpdated: payrollRun });
        return payrollRun;
      } catch (error) {
        logger.error('Mutation.runPayroll Error', { message: error.message, stack: error.stack });
        throw error;
      }
    },

    finalizePayroll: async (_, { runId }, { companyId, userRole, userId }) => {
      logger.info('Mutation.finalizePayroll called', { runId });
      try {
        requireRole(userRole, ['SUPER_ADMIN', 'ADMIN'], 'finalize payroll');

        const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
        if (!run) throw new Error('Payroll run not found');

        if (userRole !== 'SUPER_ADMIN' && run.companyId !== companyId) {
          throw new Error('Unauthorized: Cannot finalize payroll for another company');
        }

        const updated = await prisma.payrollRun.update({
          where: { id: runId },
          data: { status: 'FINALIZED', processedAt: new Date() },
        });

        await prisma.auditLog.create({
          data: {
            userId: userId || null,
            companyId: updated.companyId,
            action: 'PAYROLL_RUN_FINALIZED',
            details: { runId: updated.id, companyId: updated.companyId },
            resourceId: updated.id,
            resourceType: 'PayrollRun',
          },
        });

        pubsub.publish('PAYROLL_UPDATED', { payrollUpdated: updated });
        return updated;
      } catch (error) {
        logger.error('Mutation.finalizePayroll Error', { message: error.message, stack: error.stack });
        throw error;
      }
    },

    /**
     * NEW (2026-07-10): paymentServices.js's processPayout() has no
     * tenant awareness by design (it's also callable from a future queue
     * worker where there's no request context at all) - so this resolver
     * is the actual enforcement point for multi-tenancy here, same
     * pattern as finalizePayroll's companyId check above. Also enforces
     * the business rule that payouts can only run against a FINALIZED
     * run - disbursing money against an unreviewed DRAFT run is a
     * compliance risk, not just a data-integrity one.
     */
    processPayout: async (_, { payrollItemId, provider = 'HUBTEL' }, { companyId, userRole, userId }) => {
      logger.info('Mutation.processPayout called', { payrollItemId, provider });
      try {
        requireRole(userRole, PAYROLL_FINANCE_ROLES, 'process payroll disbursements');

        const item = await prisma.payrollItem.findUnique({
          where: { id: payrollItemId },
          include: { payrollRun: { select: { id: true, companyId: true, status: true } } },
        });

        if (!item) throw new Error('Payroll item not found');

        if (userRole !== 'SUPER_ADMIN' && item.payrollRun.companyId !== companyId) {
          logger.warn('Cross-tenant payout attempt blocked', {
            userId, payrollItemId, userCompany: companyId, targetCompany: item.payrollRun.companyId,
          });
          throw new Error('Unauthorized: Cannot process payout for another company');
        }

        if (item.payrollRun.status !== 'FINALIZED') {
          throw new Error('Payroll run must be finalized before processing payouts');
        }

        const providerKey = String(provider || 'HUBTEL').toLowerCase();
        await processPayoutService(payrollItemId, providerKey);

        const updated = await prisma.payrollItem.findUnique({ where: { id: payrollItemId } });

        // CLAUDE.md audit-trail rule: every sensitive payroll action needs
        // an AuditLog entry - a payout is money leaving the business.
        await prisma.auditLog.create({
          data: {
            userId: userId || null,
            companyId: item.payrollRun.companyId,
            action: 'PAYROLL_PAYOUT_PROCESSED',
            details: {
              payrollItemId,
              payrollRunId: item.payrollRun.id,
              provider: providerKey,
              paymentStatus: updated.paymentStatus,
            },
            resourceId: payrollItemId,
            resourceType: 'PayrollItem',
          },
        });

        return updated;
      } catch (error) {
        logger.error('Mutation.processPayout Error', { payrollItemId, message: error.message, stack: error.stack });
        throw error;
      }
    },

    processRunPayouts: async (_, { runId, provider = 'HUBTEL' }, { companyId, userRole, userId }) => {
      logger.info('Mutation.processRunPayouts called', { runId, provider });
      try {
        requireRole(userRole, PAYROLL_FINANCE_ROLES, 'process payroll disbursements');

        const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
        if (!run) throw new Error('Payroll run not found');

        if (userRole !== 'SUPER_ADMIN' && run.companyId !== companyId) {
          throw new Error('Unauthorized: Cannot process payouts for another company');
        }

        if (run.status !== 'FINALIZED') {
          throw new Error('Payroll run must be finalized before processing payouts');
        }

        const items = await prisma.payrollItem.findMany({
          where: { payrollRunId: runId, paymentStatus: { in: ['PENDING', 'FAILED'] } },
        });

        if (!items.length) {
          throw new Error('No pending or failed payroll items to disburse for this run');
        }

        const providerKey = String(provider || 'HUBTEL').toLowerCase();

        // Sequential-per-item, parallel-across-items via Promise.allSettled:
        // idempotency and retry already live inside paymentServices.js, but
        // firing 100+ concurrent provider calls from one request risks
        // rate-limit rejection from Hubtel/Paystack. For very large runs
        // this should move to a BullMQ queue (per CLAUDE.md's "queues for
        // heavy jobs" guidance) instead of blocking this resolver -
        // flagged as a scaling follow-up, not implemented here.
        const results = await Promise.allSettled(
          items.map((item) => processPayoutService(item.id, providerKey))
        );

        const succeeded = [];
        const failed = [];
        results.forEach((result, idx) => {
          if (result.status === 'fulfilled') succeeded.push(items[idx].id);
          else failed.push({ id: items[idx].id, error: result.reason?.message });
        });

        await prisma.auditLog.create({
          data: {
            userId: userId || null,
            companyId: run.companyId,
            action: 'PAYROLL_RUN_PAYOUTS_PROCESSED',
            details: { runId, provider: providerKey, succeeded, failed },
            resourceId: runId,
            resourceType: 'PayrollRun',
          },
        });

        if (failed.length) {
          logger.warn('Some payouts failed during run-level disbursement', { runId, failed });
        }

        return prisma.payrollRun.findUnique({ where: { id: runId } });
      } catch (error) {
        logger.error('Mutation.processRunPayouts Error', { runId, message: error.message, stack: error.stack });
        throw error;
      }
    },

    sendNotification: async (_, { input }, { companyId, userRole }) => {
      logger.info('Mutation.sendNotification called', { input });
      try {
        requireRole(userRole, ['SUPER_ADMIN', 'ADMIN', 'HR'], 'send notifications');

        const validated = await notificationSchema.parseAsync({
          userId: input.userId,
          type: input.type,
          channel: input.channel || 'EMAIL',
          content: {
            body: input.body,
            subject: input.subject || undefined,
          },
        });

        const notification = await prisma.notification.create({
          data: {
            userId: validated.userId,
            type: validated.type,
            channel: validated.channel,
            status: validated.status,
            content: validated.content,
            expiresAt: validated.expiresAt,
            sentAt: validated.sentAt,
            companyId: input.companyId || companyId,
          },
        });
        pubsub.publish('NOTIFICATION_SENT', { notificationSent: notification });
        return notification;
      } catch (error) {
        if (error?.issues) {
          logger.warn('Mutation.sendNotification validation failed', { issues: error.issues });
          throw new Error(error.issues.map((i) => i.message).join('; '));
        }
        logger.error('Mutation.sendNotification Error', { message: error.message, stack: error.stack });
        throw error;
      }
    },

    updatePreferences: async (_, { input }, { userId }) => {
      if (!userId) throw new Error('Unauthorized');
      try {
        return await prisma.notificationPreference.upsert({
          where: { userId },
          update: input,
          create: { userId, ...input },
        });
      } catch (error) {
        logger.error('Mutation.updatePreferences Error', { userId, message: error.message, stack: error.stack });
        throw new Error('Failed to update preferences');
      }
    },
  },

  Subscription: {
    notificationSent: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['NOTIFICATION_SENT']),
        (payload, variables, context) => payload.notificationSent.userId === context.userId
      ),
      resolve: (payload) => payload.notificationSent,
    },
    payrollUpdated: {
      subscribe: withFilter(
        () => pubsub.asyncIterator(['PAYROLL_UPDATED']),
        (payload, variables, context) =>
          payload.payrollUpdated.companyId === context.companyId &&
          PAYROLL_FINANCE_ROLES.includes(context.userRole)
      ),
      resolve: (payload) => payload.payrollUpdated,
    },
  },

  PayrollRun: {
    items: async (parent, _, { loaders }) => {
      return loaders.payrollItemsByRunLoader.load(parent.id);
    },
    totalNet: async (parent, _, { loaders }) => {
      const items = await loaders.payrollItemsByRunLoader.load(parent.id);
      return items.reduce((sum, item) => sum + (Number(item.netPay) || 0), 0);
    },
    isFinalized: (parent) => parent.status === 'FINALIZED',
  },

  PayrollItem: {
    totalNet: (parent) => parent.netPay || 0,
    isFinalized: async (parent, _, { loaders }) => {
      const run = await loaders.payrollRunLoader.load(parent.payrollRunId);
      return run?.status === 'FINALIZED';
    },
    processedAt: (parent) => parent.processedAt || parent.createdAt
  },

  Employee: {
    ghanaCardPIN: (parent) => parent.ghanaCardPin,
    ghanaCardPin: (parent) => parent.ghanaCardPin,

    allowances: (parent) => {
      const h = Number(parent.housingAllowance || 0);
      const t = Number(parent.transportAllowance || 0);
      const o = Number(parent.otherAllowance || 0);
      return h + t + o;
    },

    company: async (parent, _, { loaders, companyId, userRole }) => {
      if (userRole !== 'SUPER_ADMIN' && parent.companyId !== companyId) {
        logger.warn('Employee field resolver: Unauthorized access attempt', { parentId: parent.id, companyId });
        throw new Error('Unauthorized access to company data');
      }
      return await loaders.company.load(parent.companyId);
    },
  },
};

export const createLoaders = () => ({
  company: new DataLoader(async (ids) => {
    const companies = await prisma.company.findMany({ where: { id: { in: ids } } });
    return ids.map((id) => companies.find((c) => c.id === id) || null);
  }),

  payrollRunLoader: new DataLoader(async (runIds) => {
    const runs = await prisma.payrollRun.findMany({
      where: { id: { in: [...new Set(runIds)] } },
    });
    const runMap = new Map(runs.map((run) => [run.id, run]));
    return runIds.map((id) => runMap.get(id) || null);
  }),

  payrollItemsByRunLoader: new DataLoader(async (runIds) => {
    const items = await prisma.payrollItem.findMany({
      where: { payrollRunId: { in: [...new Set(runIds)] } },
      include: { employee: true },
    });
    const itemsMap = new Map();
    items.forEach((item) => {
      if (!itemsMap.has(item.payrollRunId)) {
        itemsMap.set(item.payrollRunId, []);
      }
      itemsMap.get(item.payrollRunId).push(item);
    });
    return runIds.map((id) => itemsMap.get(id) || []);
  }),
});

export default resolvers;