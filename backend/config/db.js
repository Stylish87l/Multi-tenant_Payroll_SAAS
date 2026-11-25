import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkgPrisma from '@prisma/client';
import logger from './logger.js';
import {
  createEmployeePiiEncryptionExtension,
  validateEmployeePiiEncryptionConfig,
} from '../services/employeePiiEncryption.js';

// @prisma/client is CJS: destructure from the default export for ESM compatibility.
const { PrismaClient, Prisma } = pkgPrisma;
export { Prisma };

/**
 * Production must not serve employee reads/writes until the maintenance backfill has
 * encrypted existing bank accounts, SSNIT numbers and Ghana Card PINs.
 * The one-off backfill command opts into a restricted startup mode.
 */
if (process.env.NODE_ENV === 'production') {
  validateEmployeePiiEncryptionConfig();
  if (
    process.env.EMPLOYEE_PII_ENCRYPTION_READY !== 'true'
    && process.env.EMPLOYEE_PII_BACKFILL_MODE !== 'true'
  ) {
    throw new Error('Employee PII encryption is not marked ready. Run the maintenance backfill before starting the application.');
  }
}

/**
 * Prisma 7 + driver adapter (@prisma/adapter-pg).
 * - Event-based logging piped through Winston (params never logged in production)
 * - Employee PII is encrypted before writes and decrypted only in Prisma result objects.
 * - Graceful shutdown is owned by server.js (via disconnectDb).
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE) || 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => logger.error('Postgres pool error (idle client)', { message: err.message }));

const adapter = new PrismaPg(pool);
const basePrisma = new PrismaClient({
  adapter,
  omit: {
    employee: {
      bankAccountEncrypted: true,
      ssnitNumberEncrypted: true,
      ssnitNumberHash: true,
      ghanaCardPinEncrypted: true,
      ghanaCardPinHash: true,
    },
  },
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

basePrisma.$on('query', (e) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('Prisma Query', { query: e.query, params: e.params, duration: `${e.duration}ms` });
  } else if (e.duration > 1000) {
    logger.warn('Slow Prisma Query', { query: e.query, duration: `${e.duration}ms` });
  }
});
basePrisma.$on('info', (e) => logger.info('Prisma Info', { message: e.message, target: e.target }));
basePrisma.$on('warn', (e) => logger.warn('Prisma Warning', { message: e.message, target: e.target }));
basePrisma.$on('error', (e) => logger.error('Prisma Error', { message: e.message, target: e.target }));

const prisma = basePrisma.$extends(createEmployeePiiEncryptionExtension());

export const disconnectDb = async () => {
  await basePrisma.$disconnect();
  await pool.end();
};

export default prisma;
