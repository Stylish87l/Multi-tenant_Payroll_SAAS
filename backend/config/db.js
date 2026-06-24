// config/db.js
console.log('>>> LOADING PRISMA CONFIG WITH ADAPTER <<<');
import logger from './logger.js';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma Singleton - Production Ready (Prisma 7+ with driver adapter)
 * - Uses @prisma/adapter-pg + pg pool (required for postgres provider)
 * - Event-based logging piped through Winston
 * - Global singleton prevents connection leaks during hot-reload/dev
 * - Graceful shutdown for cloud/docker environments
 */

// Create a connection pool (recommended for production concurrency)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE) || 20,
  idleTimeoutMillis: 30000,           // close idle connections after 30s
  connectionTimeoutMillis: 10000,      // fail fast if DB is down
  // You can add ssl: { rejectUnauthorized: false } if using self-signed certs
});

// Create the Prisma driver adapter using the pool
const adapter = new PrismaPg(pool);

/**
 * Singleton factory
 */
const prismaClientSingleton = () => {
  const client = new PrismaClient({
    adapter,                              // ← This is the required fix
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'info' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  // Query logging (redacted in production for privacy/security)
  client.$on('query', (e) => {
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('Prisma Query', {
        query: e.query,
        params: e.params,
        duration: `${e.duration}ms`,
      });
    } else if (e.duration > 1000) {
      logger.warn('Slow Prisma Query', {
        query: e.query,
        duration: `${e.duration}ms`,
      });
    }
  });

  client.$on('info', (e) => logger.info('Prisma Info', e));
  client.$on('warn', (e) => logger.warn('Prisma Warning', e));
  client.$on('error', (e) =>
    logger.error('Prisma Error', { message: e.message, target: e.target })
  );

  return client;
};

// Global singleton to prevent multiple instances in dev (hot-reload)
globalThis.prisma = globalThis.prisma || prismaClientSingleton();
const prisma = globalThis.prisma;

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Graceful shutdown handlers
const handleShutdown = async (signal) => {
  try {
    await prisma.$disconnect();
    await pool.end();                    // Also close the pg pool
    logger.info(`DB disconnected gracefully on ${signal}`);
    process.exit(0);
  } catch (error) {
    logger.error('DB disconnect error', { error: error.message });
    process.exit(1);
  }
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

export default prisma;