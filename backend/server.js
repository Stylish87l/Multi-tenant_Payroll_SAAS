import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { WebSocketServer } from 'ws';
import { ApolloServer } from '@apollo/server';
import { unwrapResolverError } from '@apollo/server/errors';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { useServer } from 'graphql-ws/use/ws';
import depthLimit from 'graphql-depth-limit';

import prisma, { disconnectDb } from './config/db.js';
import logger from './config/logger.js';
import authMiddleware from './middleware/auth.js';
import authMiddlewareGraphQL from './middleware/authMiddlewareGraphQL.js';
import errorHandler, { notFoundHandler } from './middleware/errorHandler.js';
import { verifyAccessToken, extractBearerToken } from './utils/authTokens.js';
import { AppError } from './utils/appError.js';
import { createLoaders } from './graphql/resolvers.js';

import authRouter from './routes/auth.js';
import payrollRoutes from './routes/payroll.js';
import employeeRoutes from './routes/employees.js';
import userRoutes from './routes/users.js';
import reportRoutes from './routes/reports.js';
import payslipRoutes from './routes/payslips.js';
import tenantRoutes from './routes/tenants.js';
import tenantBrandingRoutes from './routes/tenantBranding.js';
import notificationRoutes from './routes/notificationRoutes.js';
import webhookRoutes from './routes/webhooks.js';
import typeDefs from './graphql/typeDefs.js';
import resolvers from './graphql/resolvers.js';

const isProd = process.env.NODE_ENV === 'production';

// --- STARTUP SANITY CHECKS (fail fast instead of booting half-configured) ---
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
if (!process.env.NODE_ENV) {
  logger.warn('NODE_ENV is not set. Defaulting to development behaviour (permissive CORS, insecure cookies). Set NODE_ENV=production in deployment.');
}
if (isProd && !process.env.FRONTEND_URL) {
  console.error('FRONTEND_URL is required in production (CORS + invite links).');
  process.exit(1);
}

const app = express();
const httpServer = http.createServer(app);

// FIXED: `enable('trust proxy')` trusts EVERY X-Forwarded-For hop, so any client could spoof its IP
// and bypass the rate limiters. Trust exactly one proxy hop (Railway/Vercel edge). Override with TRUST_PROXY_HOPS.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);
app.disable('x-powered-by');

// --- Health (registered first so platform health checks pass while Apollo starts) ---
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'UP', database: 'connected' });
  } catch (e) {
    logger.error('Health check failed', { message: e.message });
    res.status(503).json({ status: 'DOWN', database: 'error' });
  }
});

app.use(cookieParser());

// Capture the raw body for webhook signature verification (HMAC is over the exact bytes sent).
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.use(helmet({
  contentSecurityPolicy: isProd ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

const developmentOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'https://studio.apollographql.com',
  'https://sandbox.embed.apollographql.com',
];
const allowedOrigins = new Set([
  process.env.FRONTEND_URL,
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()),
  ...(!isProd ? developmentOrigins : []),
].filter(Boolean));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    logger.warn(`Rejected Origin blocked by CORS: ${origin}`);
    // 403 (was an unhandled generic 500)
    return callback(new AppError('Not allowed by CORS', { status: 403, code: 'FORBIDDEN' }));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'apollo-require-preflight', 'x-apollo-operation-name', 'x-csrf-token', 'x-csrf-protection'],
  exposedHeaders: ['Content-Disposition'],
}));

// --- Rate limiters ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300, validate: false,
  message: { error: 'Too many authentication requests, please try again later.' },
  keyGenerator: (req) => `${req.ip}:${req.path}`,
});
const restLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 100, validate: false,
  message: { error: 'Too many requests, please try again later.' },
});
const gqlLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300, validate: false,
  message: { error: 'Too many GraphQL engine requests, please try again later.' },
});
const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 600, validate: false,
  message: { error: 'Too many webhook requests.' },
});

// --- REST routes ---
// Webhooks: before authMiddleware, verified by provider signature instead.
app.use('/api/webhooks', webhookLimiter, webhookRoutes);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/', restLimiter);

// Defence in depth: most routers ALSO apply authMiddleware themselves; keep both.
app.use('/api/payroll', authMiddleware, payrollRoutes);
app.use('/api/employees', authMiddleware, employeeRoutes);
app.use('/api/reports', authMiddleware, reportRoutes);
app.use('/api/payslips', authMiddleware, payslipRoutes);
app.use('/api/tenants', authMiddleware, tenantRoutes);
app.use('/api/companies', authMiddleware, tenantBrandingRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
// FIXED: users router was mounted behind authMiddleware, so POST /accept-invite (public by design)
// was unreachable for invitees. /invite applies authMiddleware + rbac itself.
app.use('/api/users', userRoutes);

// --- GraphQL ---
const schema = makeExecutableSchema({ typeDefs, resolvers });

const wsServer = new WebSocketServer({ server: httpServer, path: '/graphql' });

const serverCleanup = useServer(
  {
    schema,
    context: (ctx) => {
      const params = ctx.connectionParams || {};
      const header = params.authorization || params.Authorization || '';
      const token = extractBearerToken(header) || (typeof header === 'string' && header && !header.includes(' ') ? header : null);

      const base = { userId: null, companyId: null, userRole: null, isSuperAdmin: false, authError: 'TOKEN_MISSING', prisma, loaders: createLoaders() };
      if (!token) return base;
      try {
        const payload = verifyAccessToken(token);
        const isSuper = payload.role === 'SUPER_ADMIN';
        return {
          ...base,
          userId: payload.userId,
          companyId: isSuper ? null : payload.companyId,
          userRole: payload.role,
          isSuperAdmin: isSuper,
          authError: null,
        };
      } catch (err) {
        return { ...base, authError: err.code || 'TOKEN_INVALID' };
      }
    },
  },
  wsServer
);

const apolloServer = new ApolloServer({
  schema,
  validationRules: [depthLimit(7)],
  csrfPrevention: true,
  cache: 'bounded',
  // Business errors (AppError) keep their message + code. Anything unexpected (Prisma, TypeError, provider
  // SDKs) is masked in production: previously raw Prisma errors - including query arguments - reached clients.
  formatError: (formatted, error) => {
    const original = unwrapResolverError(error);
    if (original instanceof AppError) {
      return { ...formatted, message: original.message, extensions: { ...formatted.extensions, code: original.code } };
    }
    if (isProd && formatted.extensions?.code === 'INTERNAL_SERVER_ERROR') {
      logger.error('GraphQL internal error', { message: original?.message, stack: original?.stack, path: formatted.path });
      return { message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } };
    }
    return formatted;
  },
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return { async drainServer() { await serverCleanup.dispose(); } };
      },
    },
  ],
});

// Refresh-token table hygiene: nothing previously deleted expired/revoked rows.
const startMaintenance = () => {
  const run = async () => {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const { count } = await prisma.refreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }] },
      });
      if (count) logger.info('Pruned stale refresh tokens', { count });
    } catch (err) {
      logger.error('Refresh token cleanup failed', { message: err.message });
    }
  };
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
};

(async () => {
  try {
    await apolloServer.start();

    app.use(
      '/graphql',
      gqlLimiter,
      expressMiddleware(apolloServer, {
        context: async ({ req, res }) => ({
          ...authMiddlewareGraphQL(req),
          prisma,
          loaders: createLoaders(),
          req,
          res,
        }),
      })
    );

    // Must be LAST: unmatched routes, then the global error handler (was never mounted before).
    app.use(notFoundHandler);
    app.use(errorHandler);

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received. Graceful shutdown...`);
      const force = setTimeout(() => { logger.error('Forced shutdown after timeout'); process.exit(1); }, 15_000);
      force.unref();
      try {
        await apolloServer.stop(); // drains the HTTP server and websockets via plugins
        wsServer.close();
        await disconnectDb();
        logger.info('Shutdown complete.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', { message: err.message });
        process.exit(1);
      }
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      logger.info(`Stack live on port ${PORT} (GraphQL at /graphql)`);
      startMaintenance();
    });
  } catch (err) {
    console.error('Apollo Engine crash during startup', err);
    logger.error('Apollo Engine crash during startup sequence', { stack: err.stack });
    process.exit(1);
  }
})();
