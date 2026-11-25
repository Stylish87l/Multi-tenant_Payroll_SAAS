import crypto from 'node:crypto';
import { decryptSensitiveValue } from './employeePiiEncryption.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

export const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 31];
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
};

export const base32Decode = (encoded) => {
  const normalized = String(encoded || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (!normalized) throw new Error('Invalid TOTP secret.');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid TOTP secret.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 255);
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(output);
};

export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

const generateTotpAtCounter = (secret, counter) => {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
};

export const matchTotpCounter = (secret, code, timestamp = Date.now(), window = 1) => {
  const candidate = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(candidate) || !secret) return null;
  const candidateBuffer = Buffer.from(candidate);
  const counter = Math.floor(timestamp / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const matchedCounter = counter + offset;
    if (matchedCounter < 0) continue;
    const expected = Buffer.from(generateTotpAtCounter(secret, matchedCounter));
    if (expected.length === candidateBuffer.length && crypto.timingSafeEqual(expected, candidateBuffer)) return matchedCounter;
  }
  return null;
};

export const generateTotpCode = (secret, timestamp = Date.now()) => {
  const counter = Math.floor(timestamp / 1000 / TOTP_STEP_SECONDS);
  return generateTotpAtCounter(secret, counter);
};

export const verifyTotp = (secret, code, timestamp = Date.now(), window = 1) =>
  matchTotpCounter(secret, code, timestamp, window) !== null;

export const createOtpAuthUri = ({ email, secret, issuer = 'Paylio' }) => {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const parameters = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
};

export const normalizeRecoveryCode = (code) => String(code || '').toUpperCase().replace(/[\s-]/g, '');

export const hashRecoveryCode = (code) => {
  const normalized = normalizeRecoveryCode(code);
  if (!/^[A-F0-9]{24}$/.test(normalized)) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

export const generateRecoveryCodes = (count = 10) => Array.from({ length: count }, () => {
  const raw = crypto.randomBytes(12).toString('hex').toUpperCase();
  return raw.match(/.{4}/g).join('-');
});

export const consumeRecoveryCode = async (tx, userId, code) => {
  const codeHash = hashRecoveryCode(code);
  if (!codeHash) return false;
  const record = await tx.twoFactorRecoveryCode.findFirst({
    where: { userId, codeHash, usedAt: null },
    select: { id: true },
  });
  if (!record) return false;
  const result = await tx.twoFactorRecoveryCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
};

export const verifyUserTwoFactorCode = async ({ tx, user, code }) => {
  if (!user?.twoFactorEnabled || !user.twoFactorSecretEncrypted) return { valid: false, method: null };
  const secret = decryptSensitiveValue(user.twoFactorSecretEncrypted);
  const matchedCounter = matchTotpCounter(secret, code);
  if (matchedCounter !== null) {
    const consumed = await tx.user.updateMany({
      where: {
        id: user.id,
        twoFactorEnabled: true,
        OR: [
          { twoFactorLastCounter: null },
          { twoFactorLastCounter: { lt: BigInt(matchedCounter) } },
        ],
      },
      data: { twoFactorLastCounter: BigInt(matchedCounter) },
    });
    if (consumed.count === 1) return { valid: true, method: 'totp' };
  }
  const recoveryCodeUsed = await consumeRecoveryCode(tx, user.id, code);
  return { valid: recoveryCodeUsed, method: recoveryCodeUsed ? 'recovery_code' : null };
};
