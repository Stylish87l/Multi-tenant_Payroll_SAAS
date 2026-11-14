import { describe, test, expect, jest } from '@jest/globals';

jest.unstable_mockModule('../config/db.js', () => ({ default: {} }));
const { enqueueBackgroundJob } = await import('../services/backgroundJobService.js');

describe('transactional background job outbox', () => {
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
});
