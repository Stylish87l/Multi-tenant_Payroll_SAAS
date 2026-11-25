import prisma from '../config/db.js';

/** Persist work in the same database as the business transaction (transactional outbox). */
export const enqueueBackgroundJob = (tx, { type, payload, companyId = null, idempotencyKey, availableAt = new Date() }) =>
  tx.backgroundJob.create({
    data: { type, payload, companyId, idempotencyKey, availableAt },
  });

export const enqueueEmployeeReconciliation = async (companyId = null) => {
  const hourKey = new Date().toISOString().slice(0, 13);
  const key = `employee-reconcile:${companyId || 'all'}:${hourKey}`;
  try {
    return await prisma.backgroundJob.create({
      data: {
        type: 'EMPLOYEE_ACCOUNT_RECONCILIATION',
        payload: companyId ? { companyId } : {},
        companyId,
        idempotencyKey: key,
      },
    });
  } catch (error) {
    if (error?.code === 'P2002') return null;
    throw error;
  }
};


/** Queue a status lookup for a known Hubtel payout; callback payloads never update payroll state. */
export const enqueueHubtelPayoutReconciliation = async (reference) => {
  if (typeof reference !== 'string' || !reference.trim() || reference.length > 36) return false;
  const item = await prisma.payrollItem.findFirst({
    where: { paymentRef: reference, payoutProvider: 'HUBTEL', deletedAt: null },
    select: { id: true, payrollRun: { select: { companyId: true } } },
  });
  if (!item) return false;
  try {
    await prisma.backgroundJob.create({
      data: {
        type: 'HUBTEL_PAYOUT_RECONCILIATION',
        payload: { payrollItemId: item.id, reference },
        companyId: item.payrollRun.companyId,
        idempotencyKey: `hubtel-payout-reconcile:${reference}:callback`,
      },
    });
    return true;
  } catch (error) {
    if (error?.code === 'P2002') return false;
    throw error;
  }
};
