import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const prisma = { company: { findFirst: jest.fn() } };
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../utils/appError.js', () => ({
  forbidden: (message) => Object.assign(new Error(message), { statusCode: 403 }),
  notFound: (message) => Object.assign(new Error(message), { statusCode: 404 }),
}));

const companyContext = (await import('../middleware/companyContext.js')).default;
const companyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('Ask Paylio company context boundary', () => {
  beforeEach(() => prisma.company.findFirst.mockReset());
  afterEach(() => jest.clearAllMocks());

  it('rejects a tenant user attempting to select another company before querying it', async () => {
    const next = jest.fn();
    await companyContext({ params: { companyId: companyB }, userRole: 'ADMIN', companyId: companyA }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });

  it('resolves the explicitly selected company for SUPER_ADMIN', async () => {
    prisma.company.findFirst.mockResolvedValue({ id: companyB, name: 'Selected Company' });
    const req = { params: { companyId: companyB }, userRole: 'SUPER_ADMIN', companyId: null };
    const next = jest.fn();
    await companyContext(req, {}, next);
    expect(prisma.company.findFirst).toHaveBeenCalledWith({
      where: { id: companyB, deletedAt: null },
      select: { id: true, name: true },
    });
    expect(req.reviewCompanyId).toBe(companyB);
    expect(req.reviewCompanyName).toBe('Selected Company');
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects malformed company IDs', async () => {
    const next = jest.fn();
    await companyContext({ params: { companyId: 'not-a-uuid' }, userRole: 'SUPER_ADMIN' }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(prisma.company.findFirst).not.toHaveBeenCalled();
  });
});
