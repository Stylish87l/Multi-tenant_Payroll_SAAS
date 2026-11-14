import { describe, test, expect, jest } from '@jest/globals';
import rbac from '../middleware/rbac.js';

const invoke = (role, companyId, queryCompanyId) => {
  const req = { userRole: role, companyId, query: { companyId: queryCompanyId }, params: {}, body: undefined };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  rbac(['ADMIN'])(req, res, next);
  return { res, next };
};

describe('REST tenant isolation middleware', () => {
  test('blocks an administrator selecting another tenant in query parameters', () => {
    const { res, next } = invoke('ADMIN', 'tenant-a', 'tenant-b');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows an administrator to select their own tenant', () => {
    const { res, next } = invoke('ADMIN', 'tenant-a', 'tenant-a');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('keeps platform administrator cross-tenant access explicit', () => {
    const { res, next } = invoke('SUPER_ADMIN', null, 'tenant-b');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('does not let HR pass an ADMIN-only route through role inheritance', () => {
    const { res, next } = invoke('HR', 'tenant-a', undefined);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
