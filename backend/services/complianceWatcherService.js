import crypto from 'node:crypto';
import prisma from '../config/db.js';
import logger from '../config/logger.js';

const MAX_SOURCE_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_SOURCE_URLS = new Set([
  'https://gra.gov.gh/domestic-tax/tax-types/paye/',
  'https://gra.gov.gh/amendments-of-tax-laws/',
  'https://www.ssnit.org.gh/become-an-employer/',
]);

export class ComplianceSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ComplianceSourceError';
  }
}

const decodeHtmlEntities = (value) => String(value || '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_match, code) => {
    const point = Number(code);
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  })
  .replace(/&#x([\da-f]+);/gi, (_match, code) => {
    const point = Number.parseInt(code, 16);
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });

const stripHtml = (html) => decodeHtmlEntities(
  String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
).replace(/[\t\r ]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();

const extractTitle = (html, fallback) => {
  const heading = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
    || String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = heading ? stripHtml(heading[1]).slice(0, 240) : '';
  return title || fallback;
};

const readLimitedBody = async (response) => {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
    throw new ComplianceSourceError('Official source response exceeds the 1 MB limit.');
  }
  if (!response.body) throw new ComplianceSourceError('Official source returned an empty response body.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SOURCE_BYTES) {
        await reader.cancel();
        throw new ComplianceSourceError('Official source response exceeds the 1 MB limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
};

const updateSourceStatus = (sourceId, data) => prisma.complianceSource.update({
  where: { id: sourceId },
  data: { ...data, lastCheckedAt: new Date() },
});

const scanSource = async (source, { fetchImpl, signalFactory }) => {
  if (!ALLOWED_SOURCE_URLS.has(source.url)) {
    await updateSourceStatus(source.id, {
      lastStatus: 'BLOCKED',
      lastError: 'Source URL is not in the built-in official-source allowlist.',
    });
    return { baseline: 0, notices: 0, unchanged: 0, errors: 1 };
  }

  const headers = { Accept: 'text/html,application/xhtml+xml' };
  if (source.etag) headers['If-None-Match'] = source.etag;
  if (source.lastModified) headers['If-Modified-Since'] = source.lastModified;

  try {
    const response = await fetchImpl(source.url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: signalFactory(FETCH_TIMEOUT_MS),
    });

    if (response.status === 304) {
      await updateSourceStatus(source.id, { lastStatus: 'NOT_MODIFIED', lastError: null });
      return { baseline: 0, notices: 0, unchanged: 1, errors: 0 };
    }
    if (!response.ok) throw new ComplianceSourceError(`Official source returned HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new ComplianceSourceError('Official source did not return an HTML document.');
    }

    const html = await readLimitedBody(response);
    const normalizedText = stripHtml(html).slice(0, 250_000);
    if (normalizedText.length < 80) throw new ComplianceSourceError('Official source content was empty or too short to fingerprint.');
    const contentHash = crypto.createHash('sha256').update(normalizedText).digest('hex');
    const title = extractTitle(html, source.name);
    const now = new Date();
    const etag = response.headers.get('etag') || source.etag || null;
    const lastModified = response.headers.get('last-modified') || source.lastModified || null;

    if (!source.lastContentHash) {
      await updateSourceStatus(source.id, {
        lastContentHash: contentHash, etag, lastModified, lastStatus: 'BASELINE', lastError: null,
      });
      return { baseline: 1, notices: 0, unchanged: 0, errors: 0 };
    }

    if (source.lastContentHash === contentHash) {
      await updateSourceStatus(source.id, {
        etag, lastModified, lastStatus: 'UNCHANGED', lastError: null,
      });
      return { baseline: 0, notices: 0, unchanged: 1, errors: 0 };
    }

    const createdNotices = await prisma.$transaction(async (tx) => {
      const created = await tx.complianceNotice.createMany({
        data: [{
          sourceId: source.id,
          title,
          url: source.url,
          contentHash,
          excerpt: normalizedText.slice(0, 5000),
          detectedAt: now,
          status: 'NEW',
        }],
        skipDuplicates: true,
      });
      await tx.complianceSource.update({
        where: { id: source.id },
        data: {
          lastContentHash: contentHash,
          etag,
          lastModified,
          lastCheckedAt: now,
          lastStatus: 'CHANGED',
          lastError: null,
        },
      });
      return created.count;
    });
    return { baseline: 0, notices: createdNotices, unchanged: createdNotices === 0 ? 1 : 0, errors: 0 };
  } catch (error) {
    const message = String(error?.message || 'Source fetch failed').slice(0, 500);
    await updateSourceStatus(source.id, { lastStatus: 'ERROR', lastError: message });
    logger.warn('Compliance source scan failed', { sourceId: source.id, authority: source.authority, message });
    return { baseline: 0, notices: 0, unchanged: 0, errors: 1 };
  }
};

export const scanOfficialComplianceSources = async ({ fetchImpl = global.fetch, signalFactory = AbortSignal.timeout } = {}) => {
  const sources = await prisma.complianceSource.findMany({
    where: { active: true },
    orderBy: [{ authority: 'asc' }, { name: 'asc' }],
  });
  const now = Date.now();
  const dueSources = sources.filter((source) => {
    if (!source.lastCheckedAt) return true;
    const interval = Math.max(60, Number(source.pollIntervalMinutes) || 360) * 60 * 1000;
    return now - new Date(source.lastCheckedAt).getTime() >= interval;
  });
  const summary = { sources: sources.length, checked: dueSources.length, baseline: 0, notices: 0, unchanged: 0, errors: 0 };
  for (const source of dueSources) {
    const result = await scanSource(source, { fetchImpl, signalFactory });
    summary.baseline += result.baseline;
    summary.notices += result.notices;
    summary.unchanged += result.unchanged;
    summary.errors += result.errors;
  }
  return summary;
};

export const complianceSourceAllowlist = [...ALLOWED_SOURCE_URLS];
