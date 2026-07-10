import { PubSub, withFilter } from 'graphql-subscriptions';
import DataLoader from 'dataloader';
import bcrypt from 'bcrypt';
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

    // FIXED (2026-07-05, RBAC): for a non-SUPER_ADMIN caller with no
    // ctxId in context, `where: { companyId: undefined }` is NOT a filter
    // to Prisma - it's the same as omitting the where clause entirely,
    // which would have counted employees across EVERY tenant in the
    // system. Explicitly guarded, matching the pattern used everywhere
    // else in this file. Left open to all authenticated roles (unlike
    // the full `employees` list) since a bare headcount carries none of
    // the salary/PII sensitivity of the full record set, and Dashboard.jsx
    // surfaces this stat to every role per sidebarConfig.js.
    employeeCount: async (_, { companyId: argId }, { companyId: ctxId, userRole }) => {
      const targetId = userRole === 'SUPER_ADMIN' ? argId : ctxId;

      if (!targetId && userRole !== 'SUPER_ADMIN') {
        logger.warn('Query.employeeCount unauthorized: no company context', { userRole });
        throw new Error('Unauthorized: No company context');
      }

      // SUPER_ADMIN with no explicit target still gets an explicit global
      // count rather than an accidental one - {} where clause is intentional
      // and logged, not a silent fallthrough.
      if (!targetId && userRole === 'SUPER_ADMIN') {
        logger.info('Query.employeeCount: SUPER_ADMIN global count requested');
        return prisma.employee.count();
      }

      return prisma.employee.count({ where: { companyId: targetId } });
    },

    // FIXED (2026-07-05, RBAC): this is called unconditionally by
    // Dashboard.jsx, which every role (including EMPLOYEE) can view per
    // sidebarConfig.js. The underlying data (month/status/totalNet) is
    // company-wide payroll financial data that EMPLOYEE/HR must not see.
    // Since the schema field is `[PayrollRun!]!` (non-nullable list),
    // THROWING here would null out the ENTIRE GraphQL response
    // (stats + notificationsCount included), breaking the whole dashboard
    // for those roles. Returning an empty array instead keeps the page
    // functional while leaking zero financial data - the safest resolution
    // available without also changing the schema/frontend query shape.
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

    // FIXED (2026-07-05, RBAC): previously had NO role check at all -
    // any authenticated EMPLOYEE could query full company-wide payroll
    // run history (gross/net/tax totals) directly via GraphQL even though
    // routes/payroll.js's equivalent REST endpoint has always required
    // SUPER_ADMIN/ADMIN/ACCOUNTANT. This page is also not in EMPLOYEE's/HR's
    // sidebar nav, so throwing here (rather than returning an empty page,
    // as recentPayrollRuns does for the dashboard) is safe and correct.
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

    // FIXED (2026-07-05, RBAC): same gap as payrollRuns above - no role
    // check meant any EMPLOYEE could fetch a single run's full item list
    // (every colleague's gross/net/tax breakdown) by guessing/enumerating
    // a run id, in addition to the tenant-isolation check that already
    // existed here.
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

    // FIXED (2026-07-05, RBAC): declared in typeDefs but had no resolver at
    // all previously ("Cannot return null for non-nullable field") - now
    // implemented AND gated to the same finance roles as payrollRuns, since
    // this aggregates company-wide gross/PAYE/SSNIT/net totals.
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

    // FIXED: backs Settings.jsx, which previously called a query that
    // didn't exist anywhere in the schema - the Settings page crashed
    // on load, every time.
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

        // FIXED: Prisma's Employee model has housingAllowance /
        // transportAllowance / otherAllowance - there's no generic
        // `allowances` column. Writing it directly threw "Unknown
        // argument `allowances`" on every single create. The GraphQL
        // `allowances` input is mapped into otherAllowance instead;
        // housing/transport default to 0 and can be adjusted later.
        //
        // FIXED (2026-07-05): typeDefs.js's EmployeeInput has always
        // declared age/isMarried/hasResponsibility/childrenCount/
        // isDisabled/agedDependentsCount (and now bankName/bankAccount),
        // but this resolver silently dropped every one of them on the
        // floor - a client could send perfectly valid, schema-accepted
        // input and have it accepted with a 200/employee object back,
        // while the actual GRA tax-relief fields never reached the DB.
        // Every payroll run for that employee then computed PAYE relief
        // using Prisma's column defaults (age 30, unmarried, 0 children,
        // not disabled) regardless of what was submitted - understating
        // relief and overstating tax for anyone who wasn't actually a
        // 30-year-old single filer with no dependents.
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

        // FIXED: same non-existent `allowances` column issue as create.
        //
        // FIXED (2026-07-05): same silent-drop bug as createEmployee above -
        // updating an employee's marital/children/disability/age/banking
        // details via GraphQL previously appeared to succeed but never
        // touched those columns, so an admin "correcting" an employee's
        // relief info through the UI had zero effect on the next payroll
        // run. Every field below is intentionally `undefined` (not `null`)
        // when absent from input, so Prisma's partial-update semantics
        // correctly leave unspecified fields untouched rather than wiping
        // them - this matters especially for boolean fields where `false`
        // is a legitimate explicit value that must NOT be coalesced away.
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

    // FIXED: this was a stub that only created an empty PayrollRun row -
    // no PayrollItems, no SSNIT/PAYE calculation, no duplicate-run guard,
    // no audit trail (required by CLAUDE.md for every payroll run).
    //
    // FIXED (2026-07-05, data integrity): backend/schemas/payrollSchema.js
    // (used by the REST /api/payroll/run path in payrollController.js)
    // transforms the incoming "YYYY-MM" month string to "YYYY-MM-01"
    // before it's ever written to the DB. This resolver previously stored
    // whatever the client sent verbatim - and frontend/src/pages/Payroll.jsx
    // sends new Date().toISOString().slice(0,7), i.e. plain "YYYY-MM". Since
    // PayrollRun has @@unique([companyId, month]), running payroll for the
    // same calendar month through REST vs GraphQL produced two DIFFERENT
    // string values ("2026-07-01" vs "2026-07") that Postgres' unique
    // constraint could never catch as duplicates - silently allowing two
    // payroll runs (and two sets of PayrollItems) for one company-month.
    // Normalizing here makes both entry points agree on one canonical format.
    runPayroll: async (_, { month, companyId: argId }, { companyId: ctxId, userRole, userId }) => {
      logger.info('Mutation.runPayroll called', { month, argId });
      requireRole(userRole, ['SUPER_ADMIN', 'ADMIN', 'HR'], 'run payroll');

      const targetId = userRole === 'SUPER_ADMIN' ? (argId || ctxId) : ctxId;
      if (!targetId) {
        throw new Error('Unauthorized: No company context for payroll run');
      }

      // Normalize "YYYY-MM" -> "YYYY-MM-01" to match payrollSchema.js's
      // REST-side transform exactly, so the @@unique([companyId, month])
      // constraint can actually do its job regardless of entry point.
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

        // calculateSSNIT/calculatePAYE are async (they read tenant-specific
        // TaxConfig from the DB) - resolved sequentially up front so the
        // whole batch is ready before opening the transaction. Decimal
        // columns come back as Decimal.js instances, never raw JS numbers,
        // so every value is explicitly coerced with Number() before math.
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
          // FIXED (2026-07-05): pass basicSalary through so the GRA bonus
          // threshold (see utils/payeCalculator.js) is computed against
          // annual basic salary rather than assessable income.
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

          // CLAUDE.md audit-trail rule: "Every sensitive action (salary
          // change, payroll run) must trigger an AuditLog entry."
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

        // FIXED: no tenant-isolation check existed here at all - any admin
        // could finalize another company's payroll run by guessing/
        // enumerating a runId.
        if (userRole !== 'SUPER_ADMIN' && run.companyId !== companyId) {
          throw new Error('Unauthorized: Cannot finalize payroll for another company');
        }

        const updated = await prisma.payrollRun.update({
          where: { id: runId },
          // FIXED: PayrollRun previously had no `processedAt` column -
          // this write crashed every finalize call. Now backed by schema.
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

    // FIXED (2026-07-05, validation parity): previously wrote directly to
    // prisma.notification.create() with ZERO validation, completely
    // bypassing schemas/notificationSchema.js - meaning the SMS 160-char
    // gateway limit, the "expiresAt must be >= 5 minutes in the future"
    // rule, and the userId UUID check all silently did not apply when a
    // notification was sent via GraphQL instead of the REST
    // notificationController.js path. Now both entry points share the
    // exact same Zod schema, so validation can't drift between them again.
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
        // Surface Zod validation issues with useful detail instead of a
        // generic 500, matching middleware/errorHandler.js's REST behavior.
        if (error?.issues) {
          logger.warn('Mutation.sendNotification validation failed', { issues: error.issues });
          throw new Error(error.issues.map((i) => i.message).join('; '));
        }
        logger.error('Mutation.sendNotification Error', { message: error.message, stack: error.stack });
        throw error;
      }
    },

    // FIXED: backs Settings.jsx, which previously called a mutation that
    // didn't exist anywhere in the schema.
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
      // FIXED (2026-07-05, RBAC): a payroll run's financial data was
      // pushed to EVERY subscriber who merely matched on companyId, with
      // no role check - meaning an EMPLOYEE subscribed to this channel
      // (e.g. by inspecting the WS payload/dev tools) would receive live
      // gross/net/tax updates the moment any payroll run changed, the same
      // data the payrollRuns/payrollRun queries now correctly restrict.
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
    // FIXED: Optimized N+1 lookup using payrollItemsByRunLoader batching
    items: async (parent, _, { loaders }) => {
      return loaders.payrollItemsByRunLoader.load(parent.id);
    },
    // FIXED: Uses the pre-fetched loader array from memory instead of executing separate SQL count queries per row
    totalNet: async (parent, _, { loaders }) => {
      const items = await loaders.payrollItemsByRunLoader.load(parent.id);
      return items.reduce((sum, item) => sum + (Number(item.netPay) || 0), 0);
    },
    isFinalized: (parent) => parent.status === 'FINALIZED',
  },

  PayrollItem: {
    totalNet: (parent) => parent.netPay || 0,
    // FIXED: Batched through payrollRunLoader to prevent multiple unique row status roundtrips
    isFinalized: async (parent, _, { loaders }) => {
      const run = await loaders.payrollRunLoader.load(parent.payrollRunId);
      return run?.status === 'FINALIZED';
    },
    processedAt: (parent) => parent.processedAt || parent.createdAt
  },

  Employee: {
    ghanaCardPIN: (parent) => parent.ghanaCardPin,
    ghanaCardPin: (parent) => parent.ghanaCardPin,

    // FIXED: `allowances` is not a real column - it's the sum of the
    // three real allowance columns, computed on read.
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

/**
     * NEW (2026-07-10): Backs the Branding page's tenant selector for
     * SUPER_ADMIN. Strictly gated - a non-SUPER_ADMIN caller must never
     * see the full tenant directory (that alone would leak the existence
     * and names of other companies on the platform). Returns only Company
     * scalar fields already declared in typeDefs - no relation traversal
     * into employees/payrollRuns, so this cannot become an accidental
     * cross-tenant data leak even if the Company type gains relations later.
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


/**
     * NEW (2026-07-10): Backs the Branding page's tenant selector for
     * SUPER_ADMIN. Strictly gated - a non-SUPER_ADMIN caller must never
     * see the full tenant directory (that alone would leak the existence
     * and names of other companies on the platform). Returns only Company
     * scalar fields already declared in typeDefs - no relation traversal
     * into employees/payrollRuns, so this cannot become an accidental
     * cross-tenant data leak even if the Company type gains relations later.
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

export const createLoaders = () => ({
  company: new DataLoader(async (ids) => {
    const companies = await prisma.company.findMany({ where: { id: { in: ids } } });
    return ids.map((id) => companies.find((c) => c.id === id) || null);
  }),
  
  // FIXED: Expanded to handle individual PayrollRun lookups for field loops efficiently
  payrollRunLoader: new DataLoader(async (runIds) => {
    const runs = await prisma.payrollRun.findMany({
      where: { id: { in: [...new Set(runIds)] } },
    });
    const runMap = new Map(runs.map((run) => [run.id, run]));
    return runIds.map((id) => runMap.get(id) || null);
  }),

  // FIXED: Expanded to collect, select and match items per Run without stacking horizontal hits
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