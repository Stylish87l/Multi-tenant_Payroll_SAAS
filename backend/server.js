// backend/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { WebSocketServer } from 'ws';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { useServer } from 'graphql-ws/use/ws';
import depthLimit from 'graphql-depth-limit';
import jwt from 'jsonwebtoken'; 

// Configurations & Middleware
import prisma from './config/db.js';
import logger from './config/logger.js';
import authMiddleware from './middleware/auth.js';
import authMiddlewareGraphQL from './middleware/authMiddlewareGraphQL.js';
import { createLoaders } from './graphql/resolvers.js';

// Routes & GraphQL
import authRouter from './routes/auth.js';
import payrollRoutes from './routes/payroll.js';
import employeeRoutes from './routes/employees.js';
import userRoutes from './routes/users.js'; // FIXED: Path import crash neutralized
import reportRoutes from './routes/reports.js';
import payslipRoutes from './routes/payslips.js';
import tenantRoutes from './routes/tenants.js';
import tenantBrandingRoutes from './routes/tenantBranding.js';
import notificationRoutes from './routes/notificationRoutes.js';
import typeDefs from './graphql/typeDefs.js';
import resolvers from './graphql/resolvers.js';

const app = express();
const httpServer = http.createServer(app);

// FIXED: Tell Express to trust the proxy headers from Railway
app.enable('trust proxy'); 

// --- STARTUP SANITY CHECKS ---
if (!process.env.NODE_ENV) {
  logger.warn(
    '⚠️  NODE_ENV is not set. This MUST be set to "production" in Railway env vars, ' +
    'or CORS and refresh-cookie behavior may not match the deployed environment.'
  );
}
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  logger.warn(
    '⚠️  FRONTEND_URL is not set in production. Falling back to the hardcoded ' +
    'allowedOrigins list only - preview/staging frontends will be rejected by CORS.'
  );
}

// 1. Core Middlewares: Cookie parser MUST be before routes
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Debug incoming cookies (keep for one run to verify cookie detection)
app.use((req, res, next) => {
  logger.debug('Incoming cookies detected:', req.cookies);
  next();
});

// 2. Security & REFINED CORS
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false,
  })
);

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'https://studio.apollographql.com',
  'https://sandbox.embed.apollographql.com',
  'https://usepaylio.vercel.app', // Your live frontend URL
];

app.use(cors({
  origin: (origin, callback) => {
    const dynamicFrontend = process.env.FRONTEND_URL;
    
    if (
      !origin || 
      allowedOrigins.includes(origin) || 
      origin === dynamicFrontend ||
      process.env.NODE_ENV !== 'production'
    ) {
      callback(null, true);
    } else {
      logger.warn(`Rejected Origin blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'apollo-require-preflight',
    'x-apollo-operation-name',
    'x-tenant-id',
  ],
  exposedHeaders: ['set-cookie'] 
}));

// 3. Rate Limiters
const restLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many REST requests, please try again later.' },
  validate: { trustProxy: false },
});

const gqlLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many GraphQL requests, please try again later.' },
  validate: { trustProxy: false },
});

// 4. REST Routes
app.use('/api/', restLimiter);
app.use('/api/auth', authRouter);
app.use('/api/payroll', authMiddleware, payrollRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/users', userRoutes); // FIXED: Successfully mounted invitation routes
app.use('/api/reports', reportRoutes);
app.use('/api/payslips', payslipRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/companies', authMiddleware, tenantBrandingRoutes);
app.use('/api/notifications', notificationRoutes);

// 5. GraphQL Setup
const schema = makeExecutableSchema({ typeDefs, resolvers });

const wsServer = new WebSocketServer({
  server: httpServer,
  path: '/graphql',
});

const serverCleanup = useServer(
  {
    schema,
    context: (ctx) => {
      const authHeader = ctx.connectionParams?.authorization || ctx.connectionParams?.Authorization || '';
      const raw = typeof authHeader === 'string' ? authHeader.trim() : '';
      const token = raw.startsWith('Bearer ') ? raw.split(' ')[1] : raw || null;
      
      if (!token) return { userId: null, companyId: null, userRole: null, prisma, loaders: createLoaders() };

      try {
        const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        return {
          userId: payload.userId,
          companyId: payload.role === 'SUPER_ADMIN' ? null : payload.companyId,
          userRole: payload.role,
          prisma,
          loaders: createLoaders(),
        };
      } catch (err) {
        logger.error('Subscription Auth Error', { message: err.message });
        return { userId: null, companyId: null, userRole: null, prisma, loaders: createLoaders() };
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
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
});

(async () => {
  try {
    await apolloServer.start();

    app.use(
      '/graphql',
      gqlLimiter,
      expressMiddleware(apolloServer, {
        context: async ({ req, res }) => {
          const authContext = authMiddlewareGraphQL(req);

          return {
            ...authContext,
            prisma,
            loaders: createLoaders(),
            req,
            res,
          };
        },
      })
    );

    app.get('/health', async (req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'UP', database: 'connected', graphql: 'ready' });
      } catch (e) {
        logger.error('Health check failed', { message: e.message });
        res.status(503).json({ status: 'DOWN', database: 'error' });
      }
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);
      await apolloServer.stop();
      await prisma.$disconnect();
      if (wsServer) wsServer.close();
      httpServer.close(() => {
        logger.info('Process terminated.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${PORT}`);
      logger.info(`📡 GraphQL endpoint: http://localhost:${PORT}/graphql`);
    });
  } catch (err) {
    logger.error('Apollo startup failed', { stack: err.stack });
    process.exit(1);
  }
})();