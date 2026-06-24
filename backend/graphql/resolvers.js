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

// Real-time engine
const pubsub = new PubSub();

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
      console.log('DEBUG: employees resolver context ->', { ctxCompanyId, userRole, argCompanyId });
      logger.info('Query.employees called', { page, limit, ctxCompanyId, userRole });
      
      try {
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
          total, // restored from totalCount to match your specific typeDefs
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
      return prisma.employee.count({ where: { companyId: targetId } });
    },

    recentPayrollRuns: async (_, { companyId: argId, limit = 5 }, { companyId: ctxId, userRole }) => {
      const targetId = userRole === 'SUPER_ADMIN' ? argId : ctxId;
      return prisma.payrollRun.findMany({
        where: { companyId: targetId },
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
        if (process.env.NODE_ENV === 'development') throw error;
        throw new Error('Failed to fetch payroll runs');
      }
    },

    payrollRun: async (_, { id }, { companyId, userRole }) => {
      logger.info('Query.payrollRun called', { id, companyId, userRole });
      try {
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
          orderBy: { sentAt: 'desc' },
        });
        return notifications;
      } catch (error) {
        logger.error('Query.notifications Error', { message: error.message, stack: error.stack });
        throw new Error('Failed to fetch notifications');
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
          res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            path: '/api/auth/refresh',
            maxAge: computeExpiryDate().getTime() - Date.now(),
          });
          logger.info('HttpOnly refresh cookie set', { userId: user.id });
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
        const targetCompanyId = userRole === 'SUPER_ADMIN' ? (input.companyId || companyId) : companyId;
        if (!targetCompanyId) throw new Error('Unauthorized: No company context');

        const employee = await prisma.employee.create({
          data: {
            name: input.name,
            email: input.email.toLowerCase().trim(),
            basicSalary: input.basicSalary,
            allowances: input.allowances || 0,
            position: input.position,
            ghanaCardPin: input.ghanaCardPin || null,
            ssnitNumber: input.ssnitNumber || null,
            companyId: targetCompanyId,
            isActive: true,
          },
        });
        return employee;
      } catch (error) {
        logger.error('Mutation.createEmployee Error', { message: error.message, stack: error.stack });
        throw error;
      }
    },

    runPayroll: async (_, { month, companyId: argId }, { companyId: ctxId, userRole }) => {
      logger.info('Mutation.runPayroll called', { month, argId });
      const targetId = userRole === 'SUPER_ADMIN' ? argId : ctxId;
      try {
        const payrollRun = await prisma.payrollRun.create({
          data: {
            month,
            status: 'DRAFT',
            runType: 'REGULAR',
            companyId: targetId,
          },
        });
        pubsub.publish('PAYROLL_UPDATED', { payrollUpdated: payrollRun });
        return payrollRun;
      } catch (error) {
        logger.error('Mutation.runPayroll Error', { message: error.message, stack: error.stack });
        throw error;
      }
    },

    finalizePayroll: async (_, { runId }, { companyId, userRole }) => {
      logger.info('Mutation.finalizePayroll called', { runId });
      try {
        const updated = await prisma.payrollRun.update({
          where: { id: runId },
          data: { status: 'FINALIZED', processedAt: new Date() },
        });
        pubsub.publish('PAYROLL_UPDATED', { payrollUpdated: updated });
        return updated;
      } catch (error) {
        logger.error('Mutation.finalizePayroll Error', { message: error.message, stack: error.stack });
        throw error;
      }
    },

    sendNotification: async (_, { input }, { companyId, userRole }) => {
      logger.info('Mutation.sendNotification called', { input });
      try {
        const notification = await prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            channel: input.channel || 'EMAIL',
            content: { body: input.body, subject: input.subject || null },
            companyId: companyId,
            status: 'PENDING',
          },
        });
        pubsub.publish('NOTIFICATION_SENT', { notificationSent: notification });
        return notification;
      } catch (error) {
        logger.error('Mutation.sendNotification Error', { message: error.message, stack: error.stack });
        throw error;
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
        (payload, variables, context) => payload.payrollUpdated.companyId === context.companyId
      ),
      resolve: (payload) => payload.payrollUpdated,
    },
  },

  // Field Resolvers for nested data and calculated fields
  PayrollRun: {
    items: (parent) => prisma.payrollItem.findMany({ 
      where: { payrollRunId: parent.id }, 
      include: { employee: true } 
    }),
    totalNet: async (parent) => {
      const aggregate = await prisma.payrollItem.aggregate({
        where: { payrollRunId: parent.id },
        _sum: { netPay: true }
      });
      return aggregate._sum.netPay || 0;
    },
    isFinalized: (parent) => parent.status === 'FINALIZED',
    errorMessage: (parent) => parent.errorMessage || null
  },

  PayrollItem: {
    totalNet: (parent) => parent.netPay || 0,
    isFinalized: async (parent) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: parent.payrollRunId } });
      return run?.status === 'FINALIZED';
    },
    processedAt: (parent) => parent.processedAt || parent.createdAt
  },

  Employee: {
    company: async (parent, _, { loaders, companyId, userRole }) => {
      // Logic for strict multi-tenancy restored
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
});

export default resolvers;