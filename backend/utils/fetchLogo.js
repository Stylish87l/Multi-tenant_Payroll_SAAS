import dns from 'node:dns/promises';
import net from 'node:net';
import logger from '../config/logger.js';

/**
 * Fetches a tenant logo for PDF payslips.
 *
 * Previously pdfkit's doc.image() was handed the https:// URL directly. pdfkit does not fetch
 * URLs (it treats strings as file paths), so logos NEVER rendered - and had the stored value
 * been a local path, it would have been a local-file-read primitive.
 *
 * logoUrl is tenant-controlled, so fetching it is an SSRF surface: https only, resolved
 * addresses must be public, no redirects, short timeout, size and content-type limits.
 * (A DNS-rebinding race between lookup and fetch remains theoretically possible; for a hard
 * guarantee, proxy logo fetches through an egress-restricted service or store uploads in your own bucket.)
 */
const MAX_BYTES = 1024 * 1024;
const TTL_MS = 10 * 60 * 1000;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg']); // the only formats pdfkit supports
const cache = new Map();

export const isPrivateAddress = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) return isPrivateAddress(l.slice(7));
    return l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb');
  }
  return true;
};

export const getLogoBuffer = async (url) => {
  if (!url) return null;
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.buffer;

  let buffer = null;
  try {
    const embedded = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (embedded) {
      const bytes = Buffer.from(embedded[2], 'base64');
      const validPng = embedded[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const validJpeg = embedded[1] === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (bytes.length <= 512 * 1024 && (validPng || validJpeg)) return bytes;
      throw new Error('Embedded logo is invalid or exceeds 512 KB');
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Only https logo URLs are allowed');

    const addresses = await dns.lookup(parsed.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      throw new Error('Logo host resolves to a non-public address');
    }

    const res = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Logo fetch failed with status ${res.status}`);

    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) throw new Error(`Unsupported logo content-type: ${type || 'unknown'}`);

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new Error('Logo too large');

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('Logo too large');
    buffer = bytes;
  } catch (err) {
    logger.warn('Logo unavailable, rendering payslip without it', { message: err.message });
  }

  cache.set(url, { buffer, expires: Date.now() + TTL_MS }); // negative results cached too
  return buffer;
};
