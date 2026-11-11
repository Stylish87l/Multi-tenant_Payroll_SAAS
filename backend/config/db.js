import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkgPrisma from '@prisma/client';
import logger from './logger.js';

// @prisma/client is CJS: destructure from the default export for ESM compatibility.
const { PrismaClient, Prisma } = pkgPrisma;

/** Re-exported so other modules never need their own CJS/ESM workaround. */
export { Prisma };

/**
 * Prisma 7 + driver adapter (@prisma/adapter-pg).
 * - Event-based logging piped through Winston (params never logged in production)
 * - Graceful shutdown is owned by server.js (via disconnectDb) so in-flight
 *   requests drain first. This file previously registered its own SIGTERM
 *   handler that called process.exit(0) immediately, racing and defeating it.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE) || 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Without this listener, an error on an IDLE pooled client (e.g. DB restart)
// is an unhandled 'error' event and crashes the whole process.
pool.on('error', (err) => logger.error('Postgres pool error (idle client)', { message: err.message }));

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

prisma.$on('query', (e) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('Prisma Query', { query: e.query, params: e.params, duration: `${e.duration}ms` });
  } else if (e.duration > 1000) {
    logger.warn('Slow Prisma Query', { query: e.query, duration: `${e.duration}ms` });
  }
});
prisma.$on('info', (e) => logger.info('Prisma Info', { message: e.message, target: e.target }));
prisma.$on('warn', (e) => logger.warn('Prisma Warning', { message: e.message, target: e.target }));
prisma.$on('error', (e) => logger.error('Prisma Error', { message: e.message, target: e.target }));

export const disconnectDb = async () => {
  await prisma.$disconnect();
  await pool.end();
};

export default prisma;
