import 'dotenv/config';
import crypto from 'node:crypto';
import prisma, { assertDataEncryptionReady, disconnectDb } from '../config/db.js';
import logger from '../config/logger.js';
import { dispatchNotification } from '../services/notificationService.js';
import { enqueueEmployeeReconciliation } from '../services/backgroundJobService.js';
import { reconcileEmployeeAccountLinks } from '../services/employeeIdentityService.js';
import { reconcileHubtelPayout } from '../services/paymentServices.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_ATTEMPTS = 8;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
let shuttingDown = false;

const claimJob = async () => {
  const now = new Date();
  const candidate = await prisma.backgroundJob.findFirst({
    where: {
      availableAt: { lte: now },
      OR: [
        { status: 'PENDING' },
        { status: 'RUNNING', lockedAt: { lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } },
      ],
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
  });
  if (!candidate) return null;
  const lockToken = crypto.randomUUID();
  const claimed = await prisma.backgroundJob.updateMany({
    where: {
      id: candidate.id,
      availableAt: { lte: now },
      OR: [
        { status: 'PENDING' },
        { status: 'RUNNING', lockedAt: { lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } },
      ],
    },
    data: { status: 'RUNNING', lockedAt: now, lockToken, attempts: { increment: 1 } },
  });
  return claimed.count === 1 ? { ...candidate, lockToken, attempts: candidate.attempts + 1 } : null;
};

const processJob = async (job) => {
  switch (job.type) {
    case 'NOTIFICATION_DISPATCH': {
      const id = job.payload?.notificationId;
      if (!id) throw new Error('Notification job is missing notificationId');
      const notification = await prisma.notification.findUnique({ where: { id } });
      if (!notification || ['SENT', 'DELIVERED'].includes(notification.status)) return;
      if (notification.status === 'FAILED') {
        await prisma.notification.update({ where: { id }, data: { status: 'PENDING' } });
      }
      await dispatchNotification({ ...notification, status: 'PENDING' });
      const latest = await prisma.notification.findUnique({ where: { id }, select: { status: true } });
      if (latest?.status === 'FAILED') throw new Error('Notification delivery failed; retry scheduled');
      return;
    }
    case 'HUBTEL_PAYOUT_RECONCILIATION': {
      const { payrollItemId, reference } = job.payload || {};
      if (!payrollItemId || !reference) throw new Error('Hubtel payout reconciliation job is missing its payout identifiers.');
      const result = await reconcileHubtelPayout({ payrollItemId, reference });
      logger.info('Hubtel payout reconciliation completed', { jobId: job.id, ...result });
      return;
    }
    case 'EMPLOYEE_ACCOUNT_RECONCILIATION': {
      const summary = await prisma.$transaction((tx) =>
        reconcileEmployeeAccountLinks(tx, { companyId: job.payload?.companyId })
      );
      logger.info('Employee account reconciliation completed', { jobId: job.id, ...summary });
      return;
    }
    default:
      throw new Error(`Unsupported background job type: ${job.type}`);
  }
};

const finishJob = (job) => prisma.backgroundJob.updateMany({
  where: { id: job.id, status: 'RUNNING', lockToken: job.lockToken },
  data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lockToken: null, lastError: null },
});

const failJob = async (job, error) => {
  const terminal = job.attempts >= MAX_ATTEMPTS;
  const delay = Math.min(60 * 60 * 1000, 1000 * (2 ** Math.min(job.attempts, 10)));
  await prisma.backgroundJob.updateMany({
    where: { id: job.id, status: 'RUNNING', lockToken: job.lockToken },
    data: {
      status: terminal ? 'FAILED' : 'PENDING',
      availableAt: new Date(Date.now() + delay),
      lockedAt: null,
      lockToken: null,
      lastError: String(error?.message || 'Unknown error').slice(0, 2000),
    },
  });
  logger.error('Background job failed', { jobId: job.id, type: job.type, attempts: job.attempts, terminal, message: error?.message });
};

const run = async () => {
  if (process.env.NODE_ENV === 'production') await assertDataEncryptionReady();
  await enqueueEmployeeReconciliation();
  logger.info('Paylio background worker started');
  let lastReconcileHour = new Date().toISOString().slice(0, 13);
  let lastHealthReport = 0;
  while (!shuttingDown) {
    try {
      if (Date.now() - lastHealthReport >= 5 * 60 * 1000) {
        const grouped = await prisma.backgroundJob.groupBy({ by: ['status'], _count: { _all: true } });
        const counts = Object.fromEntries(grouped.map((row) => [row.status.toLowerCase(), row._count._all]));
        const health = { pending: counts.pending || 0, running: counts.running || 0, completed: counts.completed || 0, failed: counts.failed || 0 };
        if (health.failed > 0 || health.pending > 50) logger.warn('Background job queue requires attention', health);
        else logger.info('Background job queue health', health);
        lastHealthReport = Date.now();
      }
      const hour = new Date().toISOString().slice(0, 13);
      if (hour !== lastReconcileHour) {
        await enqueueEmployeeReconciliation();
        lastReconcileHour = hour;
      }
      const job = await claimJob();
      if (!job) { await sleep(1000); continue; }
      try {
        await processJob(job);
        await finishJob(job);
      } catch (error) {
        await failJob(job, error);
      }
    } catch (error) {
      logger.error('Background worker loop error', { message: error.message });
      await sleep(2000);
    }
  }
};

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received by background worker`);
  await disconnectDb();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

run().catch(async (error) => {
  logger.error('Background worker startup failed', { message: error.message, stack: error.stack });
  await disconnectDb();
  process.exit(1);
});
