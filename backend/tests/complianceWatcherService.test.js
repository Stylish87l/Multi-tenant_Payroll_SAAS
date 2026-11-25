import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const prisma = {
  complianceSource: { findMany: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};
jest.unstable_mockModule('../config/db.js', () => ({ default: prisma }));
jest.unstable_mockModule('../config/logger.js', () => ({ default: { warn: jest.fn() } }));

const { scanOfficialComplianceSources } = await import('../services/complianceWatcherService.js');

const source = {
  id: 'gra-paye',
  name: 'GRA PAYE guidance',
  authority: 'Ghana Revenue Authority',
  topic: 'PAYE',
  url: 'https://gra.gov.gh/domestic-tax/tax-types/paye/',
  etag: null,
  lastModified: null,
  lastContentHash: null,
};

const htmlResponse = (html, headers = {}) => new Response(html, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
});

describe('official Ghana compliance source watcher', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    prisma.complianceSource.findMany.mockReset().mockResolvedValue([source]);
    prisma.complianceSource.update.mockReset().mockResolvedValue({});
    prisma.$transaction.mockReset();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('establishes a baseline without raising a change notice on the first scan', async () => {
    global.fetch.mockResolvedValue(htmlResponse('<html><title>GRA PAYE</title><h1>PAYE guidance</h1><p>Official statutory guidance and tax information for employers. Please refer to the published authority guidance for further details.</p></html>'));
    const result = await scanOfficialComplianceSources({ signalFactory: () => undefined });
    expect(result).toEqual({ sources: 1, checked: 1, baseline: 1, notices: 0, unchanged: 0, errors: 0 });
    expect(prisma.complianceSource.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'gra-paye' },
      data: expect.objectContaining({ lastStatus: 'BASELINE', lastContentHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
  });

  it('creates a notice when an allowlisted official page changes', async () => {
    prisma.complianceSource.findMany.mockResolvedValue([{ ...source, lastContentHash: 'previous-hash' }]);
    const tx = {
      complianceNotice: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      complianceSource: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    global.fetch.mockResolvedValue(htmlResponse('<html><h1>New PAYE notice</h1><p>Official tax guidance has changed for employers and payroll operators. Further information is available on the authority website.</p></html>', { etag: '"v2"' }));

    const result = await scanOfficialComplianceSources({ signalFactory: () => undefined });
    expect(result.notices).toBe(1);
    expect(tx.complianceNotice.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        sourceId: 'gra-paye',
        title: 'New PAYE notice',
        url: source.url,
        status: 'NEW',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })],
      skipDuplicates: true,
    }));
    expect(tx.complianceSource.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'gra-paye' },
      data: expect.objectContaining({ lastStatus: 'CHANGED', etag: '"v2"' }),
    }));
  });

  it('uses conditional requests and records unchanged sources on HTTP 304', async () => {
    prisma.complianceSource.findMany.mockResolvedValue([{ ...source, etag: '"v1"', lastContentHash: 'known' }]);
    global.fetch.mockResolvedValue(new Response(null, { status: 304 }));
    const result = await scanOfficialComplianceSources({ signalFactory: () => undefined });
    expect(result.unchanged).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(source.url, expect.objectContaining({
      headers: expect.objectContaining({ 'If-None-Match': '"v1"' }),
      redirect: 'error',
    }));
  });

  it('skips a source until its configured polling interval elapses', async () => {
    prisma.complianceSource.findMany.mockResolvedValue([{
      ...source,
      lastCheckedAt: new Date(),
      pollIntervalMinutes: 360,
    }]);
    const result = await scanOfficialComplianceSources({ signalFactory: () => undefined });
    expect(result).toEqual({ sources: 1, checked: 0, baseline: 0, notices: 0, unchanged: 0, errors: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never fetches a source URL outside the built-in official allowlist', async () => {
    prisma.complianceSource.findMany.mockResolvedValue([{ ...source, url: 'https://attacker.example/payload' }]);
    const result = await scanOfficialComplianceSources({ signalFactory: () => undefined });
    expect(result.errors).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.complianceSource.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastStatus: 'BLOCKED' }),
    }));
  });

  it('rejects oversized source responses and records a safe error state', async () => {
    global.fetch.mockResolvedValue(htmlResponse(Buffer.alloc(1024 * 1024 + 1, 'x')));
    const result = await scanOfficialComplianceSources({ signalFactory: () => undefined });
    expect(result.errors).toBe(1);
    expect(prisma.complianceSource.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastStatus: 'ERROR', lastError: expect.stringContaining('1 MB limit') }),
    }));
  });

  it('records network failures without aborting the whole scheduled scan', async () => {
    global.fetch.mockRejectedValue(new Error('upstream timeout'));
    const result = await scanOfficialComplianceSources({ signalFactory: () => undefined });
    expect(result.errors).toBe(1);
    expect(prisma.complianceSource.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastStatus: 'ERROR', lastError: 'upstream timeout' }),
    }));
  });
});
