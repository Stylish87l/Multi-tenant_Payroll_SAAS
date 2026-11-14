import crypto from 'node:crypto';
import prisma, { disconnectDb } from '../config/db.js';
import logger from '../config/logger.js';
import { dispatchNotification } from '../services/notificationService.js';
import { enqueueEmployeeReconciliation } from '../services/backgroundJobService.js';
import { reconcileEmployeeAccountLinks } from '../services/employeeIdentityService.js';

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
  await enqueueEmployeeReconciliation();
  logger.info('Paylio background worker started');
  let lastReconcileHour = new Date().toISOString().slice(0, 13);
  while (!shuttingDown) {
    try {
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
