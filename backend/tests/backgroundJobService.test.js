import { beforeEach, describe, test, expect, jest } from '@jest/globals';

const prisma = { backgroundJob: { create: jest.fn() } };
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
const { enqueueBackgroundJob, enqueueComplianceWatcherScan } = await import('../services/backgroundJobService.js');

describe('transactional background job outbox', () => {
  beforeEach(() => prisma.backgroundJob.create.mockReset());

  test('writes a notification job through the caller transaction', async () => {
    const tx = { backgroundJob: { create: jest.fn().mockResolvedValue({ id: 'job-1' }) } };
    await enqueueBackgroundJob(tx, {
      type: 'NOTIFICATION_DISPATCH',
      payload: { notificationId: 'notification-1' },
      companyId: 'tenant-a',
      idempotencyKey: 'notification:notification-1',
    });
    expect(tx.backgroundJob.create).toHaveBeenCalledWith({
      data: {
        type: 'NOTIFICATION_DISPATCH',
        payload: { notificationId: 'notification-1' },
        companyId: 'tenant-a',
        idempotencyKey: 'notification:notification-1',
        availableAt: expect.any(Date),
      },
    });
  });

  test('schedules a single durable compliance scan per six-hour bucket', async () => {
    prisma.backgroundJob.create.mockResolvedValue({ id: 'scan-job' });
    const result = await enqueueComplianceWatcherScan();
    expect(result).toEqual({ id: 'scan-job' });
    expect(prisma.backgroundJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'COMPLIANCE_WATCHER_SCAN',
        payload: {},
        idempotencyKey: expect.stringMatching(/^compliance-watcher-scan:\d+$/),
      }),
    });
  });

  test('treats an existing idempotency key as already scheduled', async () => {
    prisma.backgroundJob.create.mockRejectedValue({ code: 'P2002' });
    await expect(enqueueComplianceWatcherScan()).resolves.toBeNull();
  });
});
