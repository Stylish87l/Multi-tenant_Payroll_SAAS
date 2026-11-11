import logger from '../config/logger.js';

/**
 * Audit trail helpers (CLAUDE.md: every sensitive action must write an AuditLog).
 *
 * `actor` = { userId, companyId, ip, userAgent } - build it with actorFromReq /
 * actorFromCtx so REST and GraphQL write identical records.
 */
export const actorFromReq = (req) => ({
  userId: req.userId || null,
  companyId: req.companyId || null,
  ip: req.ip || null,
  userAgent: req.get?.('User-Agent') || null,
});

export const actorFromCtx = (ctx) => ({
  userId: ctx.userId || null,
  companyId: ctx.companyId || null,
  ip: ctx.req?.ip || null,
  userAgent: ctx.req?.get?.('User-Agent') || null,
});

const toData = ({ actor, companyId, action, resourceType, resourceId, details }) => ({
  userId: actor?.userId || null,
  companyId: companyId ?? actor?.companyId ?? null,
  action,
  details: details ?? {},
  resourceType: resourceType ?? null,
  resourceId: resourceId ?? null,
  ipAddress: actor?.ip || null,
  userAgent: actor?.userAgent || null,
});

/** Use INSIDE a transaction (`client` = tx) so the action and its audit record commit together. */
export const writeAudit = (client, params) => client.auditLog.create({ data: toData(params) });

/** Use AFTER an irreversible side effect (e.g. money already sent): never turns a success into an error. */
export const writeAuditSafe = async (client, params) => {
  try {
    await writeAudit(client, params);
  } catch (err) {
    logger.error('AUDIT_WRITE_FAILED', { action: params.action, resourceId: params.resourceId, message: err.message });
  }
};
