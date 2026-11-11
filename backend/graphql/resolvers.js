import { PubSub, withFilter } from 'graphql-subscriptions';
import DataLoader from 'dataloader';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import prisma, { Prisma } from '../config/db.js';
import logger from '../config/logger.js';
import { signAccessToken, signRefreshToken, computeExpiryDate } from '../utils/authTokens.js';
import { REFRESH_COOKIE_NAME, getRefreshCookieOptions } from '../config/cookies.js';
import { processPayout as processPayoutService } from '../services/paymentServices.js';
import { createDraftPayrollRun } from '../services/payrollService.js';
import { createNotification } from '../services/notificationService.js';
import { writeAudit, writeAuditSafe, actorFromCtx } from '../services/auditService.js';
import employeeSchema, { validateEmployeeBusinessRules } from '../schemas/employeeSchema.js';
import { registerSchema } from '../schemas/authSchema.js';
import { isLocked, recordFailure, clearFailures } from '../utils/loginThrottle.js';
import {
  AppError, unauthenticated, forbidden, notFound, badInput, conflict, zodToAppError,
} from '../utils/appError.js';

const pubsub = new PubSub();
// graphql-subscriptions v3 renamed asyncIterator -> asyncIterableIterator; support both.
const iterate = (triggers) =>
  (typeof pubsub.asyncIterableIterator === 'function' ? pubsub.asyncIterableIterator(triggers) : pubsub.asyncIterator(triggers));

// ---------------------------------------------------------------------------
// Authorisation helpers.
// FIXED: failures are now typed AppErrors. Plain `Error`s surfaced as
// INTERNAL_SERVER_ERROR, so the frontend's UNAUTHENTICATED-triggered token refresh
// never fired, and production masking could not tell business errors from bugs.
// ---------------------------------------------------------------------------
const requireAuth = (ctx) => {
  if (!ctx.userId) throw unauthenticated(ctx.authError === 'TOKEN_EXPIRED' ? 'Session expired' : 'Authentication required');
};

const requireRole = (ctx, allowedRoles, action = 'perform this action') => {
  requireAuth(ctx);
  if (!allowedRoles.includes(ctx.userRole)) throw forbidden(`You do not have permission to ${action}`);
};

// Roles permitted to see payroll FINANCIAL data. Mirrors sidebarConfig.js and routes/payroll.js
// so REST, GraphQL and the UI agree on who can see money. HR is intentionally excluded.
const PAYROLL_FINANCE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'];
const EMPLOYEE_MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR'];

const MAX_PAGE_SIZE = 100;
const paginate = (page, limit, defaultLimit = 10) => {
  const take = Math.min(Math.max(Number(limit) || defaultLimit, 1), MAX_PAGE_SIZE);
  const safePage = Math.max(Number(page) || 1, 1);
  return { take, page: safePage, skip: (safePage - 1) * take };
};

const pageInfo = ({ page, skip }, items, total) => ({
  hasNextPage: skip + items.length < total,
  hasPreviousPage: page > 1,
  startCursor: items.length ? items[0].id : null,
  endCursor: items.length ? items[items.length - 1].id : null,
});

/** SUPER_ADMIN picks a tenant via argument; everyone else is pinned to their JWT tenant. */
const resolveTenant = (ctx, argId) => (ctx.userRole === 'SUPER_ADMIN' ? argId || null : ctx.companyId);

const translatePrismaError = (err) => {
  if (err?.code === 'P2002') return conflict('A record with the same email, SSNIT number or Ghana Card already exists.');
  if (err?.code === 'P2025') return notFound('Record not found.');
  if (err?.code === 'P2003') return badInput('A referenced record does not exist.');
  return err;
};

// Maps the GraphQL EmployeeInput shape onto the Zod employeeSchema shape.
const toEmployeePayload = (input) => {
  const {
    companyId: _companyId, ghanaCardPIN, ghanaCardPin, allowances,
    housingAllowance, transportAllowance, otherAllowance, ...rest
  } = input;
  const payload = {};
  for (const [k, v] of Object.entries(rest)) if (v !== null && v !== undefined) payload[k] = v;

  const pin = ghanaCardPin ?? ghanaCardPIN;
  if (pin !== null && pin !== undefined) payload.ghanaCardPin = pin;

  if (housingAllowance != null) payload.housingAllowance = housingAllowance;
  if (transportAllowance != null) payload.transportAllowance = transportAllowance;
  if (otherAllowance != null) payload.otherAllowance = otherAllowance;
  // Legacy aggregate maps entirely to otherAllowance when no specific field was sent.
  if (allowances != null && housingAllowance == null && transportAllowance == null && otherAllowance == null) {
    payload.otherAllowance = allowances;
  }
  return payload;
};

const parseWith = (schema, data) => {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err?.issues) throw zodToAppError(err);
    throw err;
  }
};

// bcrypt compare against this when the user doesn't exist, so response time doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('paylio-timing-equaliser', 12);

const issueSession = async (user, { req, res }) => {
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
      deviceInfo: req?.get?.('User-Agent') || null,
      ipAddress: req?.ip || null,
    },
  });

  if (res && typeof res.cookie === 'function') {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
  } else {
    logger.warn('issueSession: res unavailable in context, refresh cookie NOT set', { userId: user.id });
  }
  return accessToken;
};

/** Run async work with bounded concurrency (provider rate limits). */
const settleWithConcurrency = async (items, worker, limit = 5) => {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
};

const resolvers = {
  Query: {
    me: async (_, __, ctx) => {
      if (!ctx.userId) return null;
      try {
        return await prisma.user.findUnique({ where: { id: ctx.userId }, include: { company: true } });
      } catch (error) {
        logger.error('Query.me Error', { userId: ctx.userId, message: error.message, stack: error.stack });
        throw new Error('Failed to fetch user profile');
      }
    },

    companies: async (_, __, ctx) => {
      requireRole(ctx, ['SUPER_ADMIN'], 'view the tenant directory');
      return prisma.company.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true, name: true, tin: true, address: true, themeColor: true, logoUrl: true,
          footerNote: true, payslipTemplate: true, createdBy: true, createdAt: true,
        },
      });
    },

    employees: async (_, { page, limit, search, companyId: argCompanyId }, ctx) => {
      requireRole(ctx, EMPLOYEE_MANAGER_ROLES, 'view employee records');

      const tenantId = resolveTenant(ctx, argCompanyId);
      if (!tenantId && ctx.userRole !== 'SUPER_ADMIN') throw forbidden('No company context');

      const p = paginate(page, limit);
      const where = {
        AND: [
          tenantId ? { companyId: tenantId } : {}, // SUPER_ADMIN without a tenant sees all
          search ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { position: { contains: search, mode: 'insensitive' } },
            ],
          } : {},
        ],
      };

      // No `include: { company }`: Employee.company is resolved lazily through the DataLoader.
      const [items, total] = await Promise.all([
        prisma.employee.findMany({ where, skip: p.skip, take: p.take, orderBy: { name: 'asc' } }),
        prisma.employee.count({ where }),
      ]);
      return { items, total, page: p.page, limit: p.take, pageInfo: pageInfo(p, items, total) };
    },

    employeeCount: async (_, { companyId: argId }, ctx) => {
      requireAuth(ctx);
      // The dashboard calls this for every role; restricted roles get 0 instead of an error.
      if (![...EMPLOYEE_MANAGER_ROLES, 'ACCOUNTANT'].includes(ctx.userRole)) return 0;

      const tenantId = resolveTenant(ctx, argId);
      if (!tenantId && ctx.userRole !== 'SUPER_ADMIN') throw forbidden('No company context');
      return prisma.employee.count({ where: tenantId ? { companyId: tenantId } : {} });
    },

    recentPayrollRuns: async (_, { companyId: argId, limit = 5 }, ctx) => {
      requireAuth(ctx);
      if (!PAYROLL_FINANCE_ROLES.includes(ctx.userRole)) return [];

      const tenantId = resolveTenant(ctx, argId);
      if (!tenantId && ctx.userRole !== 'SUPER_ADMIN') throw forbidden('No company context');

      return prisma.payrollRun.findMany({
        where: tenantId ? { companyId: tenantId } : {},
        take: Math.min(Math.max(Number(limit) || 5, 1), 50),
        orderBy: { createdAt: 'desc' },
      });
    },

    // FIXED: accepted ANY userId, letting any user read another user's pending-notification count.
    pendingNotifications: async (_, { userId: argId }, ctx) => {
      requireAuth(ctx);
      const target = ctx.userRole === 'SUPER_ADMIN' ? argId || ctx.userId : ctx.userId;
      return prisma.notification.count({ where: { userId: target, status: 'PENDING' } });
    },

    payrollRuns: async (_, { page, limit, companyId: argId }, ctx) => {
      requireRole(ctx, PAYROLL_FINANCE_ROLES, 'view payroll runs');

      const tenantId = resolveTenant(ctx, argId);
      if (!tenantId && ctx.userRole !== 'SUPER_ADMIN') throw forbidden('No company context');

      const p = paginate(page, limit);
      const where = tenantId ? { companyId: tenantId } : {};
      const [items, total] = await Promise.all([
        prisma.payrollRun.findMany({ where, skip: p.skip, take: p.take, orderBy: { createdAt: 'desc' } }),
        prisma.payrollRun.count({ where }),
      ]);
      return { items, total, page: p.page, limit: p.take, pageInfo: pageInfo(p, items, total) };
    },

    payrollRun: async (_, { id }, ctx) => {
      requireRole(ctx, PAYROLL_FINANCE_ROLES, 'view payroll run details');
      const run = await prisma.payrollRun.findFirst({
        where: ctx.userRole === 'SUPER_ADMIN' ? { id } : { id, companyId: ctx.companyId },
        include: { items: { include: { employee: true } } },
      });
      if (!run) throw notFound('Payroll run not found or access denied');
      return run;
    },

    notifications: async (_, { page, limit }, ctx) => {
      requireAuth(ctx);
      const p = paginate(page, limit);
      return prisma.notification.findMany({
        where: { userId: ctx.userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
      });
    },

    // Declared in typeDefs but previously had NO resolver (every call returned an error).
    auditLogs: async (_, { companyId: argId, page, limit }, ctx) => {
      requireRole(ctx, ['SUPER_ADMIN', 'ADMIN'], 'view audit logs');
      const tenantId = resolveTenant(ctx, argId);
      if (!tenantId && ctx.userRole !== 'SUPER_ADMIN') throw forbidden('No company context');

      const p = paginate(page, limit, 25);
      return prisma.auditLog.findMany({
        where: tenantId ? { companyId: tenantId } : {},
        skip: p.skip,
        take: p.take,
        orderBy: { createdAt: 'desc' },
      });
    },

    payrollSummaryReport: async (_, { companyId: argId, month }, ctx) => {
      requireRole(ctx, PAYROLL_FINANCE_ROLES, 'view payroll summary reports');
      const tenantId = ctx.userRole === 'SUPER_ADMIN' ? argId || ctx.companyId : ctx.companyId;
      if (!tenantId) throw forbidden('No company context');

      const normalized = month && /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;
      const where = { payrollRun: { companyId: tenantId, ...(normalized ? { month: normalized } : {}) } };

      const [aggregate, employeeCount] = await Promise.all([
        prisma.payrollItem.aggregate({ where, _sum: { grossSalary: true, payeTax: true, ssnitEmployee: true, netPay: true } }),
        prisma.payrollItem.count({ where }),
      ]);

      return {
        totalGross: aggregate._sum.grossSalary || 0,
        totalPAYE: aggregate._sum.payeTax || 0,
        totalSSNIT: aggregate._sum.ssnitEmployee || 0,
        totalNetPay: aggregate._sum.netPay || 0,
        employeeCount,
      };
    },

    preferences: async (_, __, ctx) => {
      requireAuth(ctx);
      return prisma.notificationPreference.upsert({ where: { userId: ctx.userId }, update: {}, create: { userId: ctx.userId } });
    },
  },

  Mutation: {
    /**
     * Public self-service sign-up creates a brand-new tenant AND an ADMIN. In production it is
     * disabled unless ALLOW_PUBLIC_REGISTRATION=true (no UI uses it today). Passwords are now
     * validated by the same rules as invites, and a refresh session is issued like login does.
     */
    register: async (_, args, ctx) => {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PUBLIC_REGISTRATION !== 'true') {
        throw forbidden('Public registration is disabled. Contact your administrator.');
      }
      const { email, password, name, companyName } = parseWith(registerSchema, args);

      if (await prisma.user.findUnique({ where: { email } })) throw conflict('User with this email already exists');

      const hashedPassword = await bcrypt.hash(password, 12);
      try {
        const { user, company } = await prisma.$transaction(async (tx) => {
          const createdCompany = await tx.company.create({ data: { name: companyName } });
          const createdUser = await tx.user.create({
            data: { email, name, password: hashedPassword, role: 'ADMIN', companyId: createdCompany.id, status: 'ACTIVE' },
          });
          await writeAudit(tx, {
            actor: { userId: createdUser.id, companyId: createdCompany.id, ip: ctx.req?.ip, userAgent: ctx.req?.get?.('User-Agent') },
            action: 'TENANT_REGISTERED', resourceType: 'Company', resourceId: createdCompany.id,
          });
          return { user: createdUser, company: createdCompany };
        });

        const accessToken = await issueSession(user, ctx);
        return { accessToken, companyId: company.id, user: { ...user, company } };
      } catch (error) {
        throw translatePrismaError(error);
      }
    },

    login: async (_, { email, password }, ctx) => {
      const normalizedEmail = String(email || '').toLowerCase().trim();
      const invalid = () => new AppError('Invalid email or password', { status: 401, code: 'UNAUTHENTICATED_LOGIN' });

      if (isLocked(normalizedEmail)) {
        logger.warn('Login blocked: too many failed attempts', { ip: ctx.req?.ip });
        throw new AppError('Too many failed attempts. Please try again in 15 minutes.', { status: 429, code: 'TOO_MANY_ATTEMPTS' });
      }
      if (typeof password !== 'string' || password.length === 0 || password.length > 128) throw invalid();

      const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, include: { company: true } });
      const passwordOk = await bcrypt.compare(password, user?.password || DUMMY_HASH);

      if (!user || !passwordOk || user.deletedAt) {
        recordFailure(normalizedEmail);
        logger.warn('Login failed', { ip: ctx.req?.ip });
        throw invalid();
      }
      if (user.status !== 'ACTIVE') {
        throw new AppError(user.status === 'PENDING' ? 'Please accept your invitation first' : 'Account is suspended', { status: 403, code: 'FORBIDDEN' });
      }

      clearFailures(normalizedEmail);
      const accessToken = await issueSession(user, ctx);
      logger.info('Login success', { userId: user.id });
      return { accessToken, companyId: user.companyId || null, user };
    },

    createEmployee: async (_, { input }, ctx) => {
      requireRole(ctx, EMPLOYEE_MANAGER_ROLES, 'create employee records');

      const targetCompanyId = ctx.userRole === 'SUPER_ADMIN' ? input.companyId || ctx.companyId : ctx.companyId;
      if (!targetCompanyId) throw forbidden('No company context');

      // FIXED: GraphQL had NO server-side validation (REST had Zod): negative salaries, malformed
      // Ghana Card PINs, ages of 500 were all accepted. Both paths now share employeeSchema.
      const data = parseWith(employeeSchema, toEmployeePayload(input));
      const ruleError = validateEmployeeBusinessRules(data);
      if (ruleError) throw badInput(ruleError);

      try {
        const employee = await prisma.$transaction(async (tx) => {
          const created = await tx.employee.create({ data: { ...data, companyId: targetCompanyId } });
          await writeAudit(tx, {
            actor: actorFromCtx(ctx), companyId: targetCompanyId, action: 'EMPLOYEE_CREATED',
            resourceType: 'Employee', resourceId: created.id,
            details: { employeeId: created.id, basicSalary: String(created.basicSalary) },
          });
          return created;
        });
        return employee;
      } catch (error) {
        throw translatePrismaError(error);
      }
    },

    updateEmployee: async (_, { id, input }, ctx) => {
      requireRole(ctx, EMPLOYEE_MANAGER_ROLES, 'update employee records');

      // Single tenant-scoped lookup: another tenant's id is indistinguishable from a missing one.
      const existing = await prisma.employee.findFirst({
        where: ctx.userRole === 'SUPER_ADMIN' ? { id } : { id, companyId: ctx.companyId },
      });
      if (!existing) throw notFound('Employee not found');

      const data = parseWith(employeeSchema.partial(), toEmployeePayload(input));
      const ruleError = validateEmployeeBusinessRules(data, existing);
      if (ruleError) throw badInput(ruleError);

      const salaryChanged = data.basicSalary !== undefined && Number(data.basicSalary) !== Number(existing.basicSalary);

      try {
        return await prisma.$transaction(async (tx) => {
          const updated = await tx.employee.update({ where: { id }, data });
          await writeAudit(tx, {
            actor: actorFromCtx(ctx), companyId: existing.companyId,
            action: salaryChanged ? 'EMPLOYEE_SALARY_CHANGED' : 'EMPLOYEE_UPDATED',
            resourceType: 'Employee', resourceId: id,
            details: {
              employeeId: id, changedFields: Object.keys(data),
              ...(salaryChanged ? { previousSalary: String(existing.basicSalary), newSalary: String(data.basicSalary) } : {}),
            },
          });
          return updated;
        });
      } catch (error) {
        throw translatePrismaError(error);
      }
    },

    // Roles aligned with REST (routes/payroll.js) and the UI: HR must not run payroll.
    runPayroll: async (_, { month, companyId: argId }, ctx) => {
      requireRole(ctx, PAYROLL_FINANCE_ROLES, 'run payroll');
      const tenantId = ctx.userRole === 'SUPER_ADMIN' ? argId || ctx.companyId : ctx.companyId;
      if (!tenantId) throw forbidden('No company context for payroll run');

      const run = await createDraftPayrollRun({ companyId: tenantId, month, actor: actorFromCtx(ctx) });
      pubsub.publish('PAYROLL_UPDATED', { payrollUpdated: run });
      return run;
    },

    finalizePayroll: async (_, { runId }, ctx) => {
      requireRole(ctx, ['SUPER_ADMIN', 'ADMIN'], 'finalize payroll');

      const run = await prisma.payrollRun.findFirst({
        where: ctx.userRole === 'SUPER_ADMIN' ? { id: runId } : { id: runId, companyId: ctx.companyId },
      });
      if (!run) throw notFound('Payroll run not found');

      // FIXED: no status guard - cancelled or already-finalized runs could be "finalized" again.
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.payrollRun.updateMany({
          where: { id: runId, status: 'DRAFT' },
          data: { status: 'FINALIZED', processedAt: new Date() },
        });
        if (result.count !== 1) throw conflict(`Only DRAFT payroll runs can be finalized (this run is ${run.status}).`);
        await writeAudit(tx, {
          actor: actorFromCtx(ctx), companyId: run.companyId, action: 'PAYROLL_RUN_FINALIZED',
          resourceType: 'PayrollRun', resourceId: runId, details: { runId, month: run.month },
        });
        return tx.payrollRun.findUnique({ where: { id: runId } });
      });

      pubsub.publish('PAYROLL_UPDATED', { payrollUpdated: updated });
      return updated;
    },

    // New: a wrong DRAFT could never be corrected (unique companyId+month blocks a re-run).
    discardPayrollDraft: async (_, { runId }, ctx) => {
      requireRole(ctx, ['SUPER_ADMIN', 'ADMIN'], 'discard payroll drafts');

      const run = await prisma.payrollRun.findFirst({
        where: ctx.userRole === 'SUPER_ADMIN' ? { id: runId } : { id: runId, companyId: ctx.companyId },
      });
      if (!run) throw notFound('Payroll run not found');

      await prisma.$transaction(async (tx) => {
        const result = await tx.payrollRun.deleteMany({ where: { id: runId, status: 'DRAFT' } }); // items cascade
        if (result.count !== 1) throw conflict('Only DRAFT payroll runs can be discarded.');
        await writeAudit(tx, {
          actor: actorFromCtx(ctx), companyId: run.companyId, action: 'PAYROLL_RUN_DISCARDED',
          resourceType: 'PayrollRun', resourceId: runId, details: { month: run.month },
        });
      });
      return true;
    },

    processPayout: async (_, { payrollItemId, provider = 'HUBTEL' }, ctx) => {
      requireRole(ctx, PAYROLL_FINANCE_ROLES, 'process payroll disbursements');

      const item = await prisma.payrollItem.findFirst({
        where: ctx.userRole === 'SUPER_ADMIN' ? { id: payrollItemId } : { id: payrollItemId, payrollRun: { companyId: ctx.companyId } },
        include: { payrollRun: { select: { id: true, companyId: true, status: true } } },
      });
      if (!item) throw notFound('Payroll item not found');
      if (item.payrollRun.status !== 'FINALIZED') throw conflict('Payroll run must be finalized before processing payouts');

      const providerKey = String(provider || 'HUBTEL').toLowerCase();
      try {
        await processPayoutService(payrollItemId, providerKey);
      } catch (error) {
        // Guard errors (already paid, no bank details, provider not configured) are user-actionable.
        if (error?.name === 'PayoutStateError') throw badInput(error.message);
        throw error;
      }

      const updated = await prisma.payrollItem.findUnique({ where: { id: payrollItemId } });
      await writeAuditSafe(prisma, {
        actor: actorFromCtx(ctx), companyId: item.payrollRun.companyId, action: 'PAYROLL_PAYOUT_PROCESSED',
        resourceType: 'PayrollItem', resourceId: payrollItemId,
        details: { payrollRunId: item.payrollRun.id, provider: providerKey, paymentStatus: updated.paymentStatus },
      });
      return updated;
    },

    processRunPayouts: async (_, { runId, provider = 'HUBTEL' }, ctx) => {
      requireRole(ctx, PAYROLL_FINANCE_ROLES, 'process payroll disbursements');

      const run = await prisma.payrollRun.findFirst({
        where: ctx.userRole === 'SUPER_ADMIN' ? { id: runId } : { id: runId, companyId: ctx.companyId },
      });
      if (!run) throw notFound('Payroll run not found');
      if (run.status !== 'FINALIZED') throw conflict('Payroll run must be finalized before processing payouts');

      const items = await prisma.payrollItem.findMany({
        where: { payrollRunId: runId, paymentStatus: { in: ['PENDING', 'FAILED'] } },
      });
      if (!items.length) throw badInput('No pending or failed payroll items to disburse for this run');

      const providerKey = String(provider || 'HUBTEL').toLowerCase();
      // Bounded concurrency (was Promise.allSettled over ALL items at once: provider rate-limit risk).
      // For very large runs this should move to a queue worker.
      const results = await settleWithConcurrency(items, (item) => processPayoutService(item.id, providerKey), 5);

      const succeeded = [];
      const failed = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') succeeded.push(items[i].id);
        else failed.push({ id: items[i].id, error: r.reason?.message });
      });

      await writeAuditSafe(prisma, {
        actor: actorFromCtx(ctx), companyId: run.companyId, action: 'PAYROLL_RUN_PAYOUTS_PROCESSED',
        resourceType: 'PayrollRun', resourceId: runId, details: { provider: providerKey, succeeded: succeeded.length, failed },
      });
      if (failed.length) logger.warn('Some payouts failed during run-level disbursement', { runId, failedCount: failed.length });

      return prisma.payrollRun.findUnique({ where: { id: runId } });
    },

    sendNotification: async (_, { input }, ctx) => {
      requireRole(ctx, EMPLOYEE_MANAGER_ROLES, 'send notifications');
      const notification = await createNotification({
        actor: { userId: ctx.userId, companyId: ctx.companyId, role: ctx.userRole },
        input: {
          userId: input.userId,
          type: input.type,
          channel: input.channel || 'EMAIL',
          content: { body: input.body, subject: input.subject || undefined },
        },
      });
      pubsub.publish('NOTIFICATION_SENT', { notificationSent: notification });
      return notification;
    },

    updatePreferences: async (_, { input }, ctx) => {
      requireAuth(ctx);
      // Drop nulls (non-nullable columns). twoFactorEnabled is not in the input type at all.
      const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined));
      return prisma.notificationPreference.upsert({
        where: { userId: ctx.userId },
        update: data,
        create: { userId: ctx.userId, ...data },
      });
    },
  },

  Subscription: {
    notificationSent: {
      subscribe: withFilter(
        () => iterate(['NOTIFICATION_SENT']),
        (payload, _vars, ctx) => !!ctx.userId && payload.notificationSent.userId === ctx.userId
      ),
      resolve: (payload) => payload.notificationSent,
    },
    payrollUpdated: {
      subscribe: withFilter(
        () => iterate(['PAYROLL_UPDATED']),
        (payload, _vars, ctx) =>
          !!ctx.companyId &&
          payload.payrollUpdated.companyId === ctx.companyId &&
          PAYROLL_FINANCE_ROLES.includes(ctx.userRole)
      ),
      resolve: (payload) => payload.payrollUpdated,
    },
  },

  PayrollRun: {
    items: (parent, _, { loaders }) => loaders.payrollItemsByRunLoader.load(parent.id),
    // Aggregated in SQL (one groupBy per batch) instead of loading every item + employee per run.
    totalNet: (parent, _, { loaders }) => loaders.payrollRunTotalLoader.load(parent.id),
    isFinalized: (parent) => parent.status === 'FINALIZED',
  },

  PayrollItem: {
    totalNet: (parent) => parent.netPay || 0,
    isFinalized: async (parent, _, { loaders }) => {
      const run = await loaders.payrollRunLoader.load(parent.payrollRunId);
      return run?.status === 'FINALIZED';
    },
    processedAt: (parent) => parent.processedAt || parent.createdAt,
  },

  Employee: {
    ghanaCardPIN: (parent) => parent.ghanaCardPin,
    ghanaCardPin: (parent) => parent.ghanaCardPin,
    allowances: (parent) =>
      new Prisma.Decimal(parent.housingAllowance || 0)
        .plus(parent.transportAllowance || 0)
        .plus(parent.otherAllowance || 0),

    company: async (parent, _, { loaders, companyId, userRole }) => {
      if (userRole !== 'SUPER_ADMIN' && parent.companyId !== companyId) {
        logger.warn('Employee field resolver: unauthorized access attempt', { parentId: parent.id });
        throw forbidden('Unauthorized access to company data');
      }
      return loaders.company.load(parent.companyId);
    },
  },
};

export const createLoaders = () => ({
  company: new DataLoader(async (ids) => {
    const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(ids)] } } });
    const map = new Map(companies.map((c) => [c.id, c]));
    return ids.map((id) => map.get(id) || null);
  }),

  payrollRunLoader: new DataLoader(async (runIds) => {
    const runs = await prisma.payrollRun.findMany({ where: { id: { in: [...new Set(runIds)] } } });
    const map = new Map(runs.map((r) => [r.id, r]));
    return runIds.map((id) => map.get(id) || null);
  }),

  payrollRunTotalLoader: new DataLoader(async (runIds) => {
    const rows = await prisma.payrollItem.groupBy({
      by: ['payrollRunId'],
      where: { payrollRunId: { in: [...new Set(runIds)] } },
      _sum: { netPay: true },
    });
    const map = new Map(rows.map((r) => [r.payrollRunId, r._sum.netPay]));
    return runIds.map((id) => map.get(id) ?? new Prisma.Decimal(0));
  }),

  payrollItemsByRunLoader: new DataLoader(async (runIds) => {
    const items = await prisma.payrollItem.findMany({
      where: { payrollRunId: { in: [...new Set(runIds)] } },
      include: { employee: true },
    });
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.payrollRunId)) map.set(item.payrollRunId, []);
      map.get(item.payrollRunId).push(item);
    }
    return runIds.map((id) => map.get(id) || []);
  }),
});

export default resolvers;
