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
import userRoutes from './routes/users.js';
import reportRoutes from './routes/reports.js';
import payslipRoutes from './routes/payslips.js';
import tenantRoutes from './routes/tenants.js';
import tenantBrandingRoutes from './routes/tenantBranding.js';
import notificationRoutes from './routes/notificationRoutes.js';
import typeDefs from './graphql/typeDefs.js';
import resolvers from './graphql/resolvers.js';

const app = express();
const httpServer = http.createServer(app);

// CRITICAL: Express proxy configurations MUST precede rate-limit bindings
// to properly resolve incoming client IP addresses on platforms like Railway.
app.enable('trust proxy'); 

// --- STARTUP SANITY CHECKS ---
if (!process.env.NODE_ENV) {
  logger.warn('⚠️  NODE_ENV is not set. Defaulting to development behavior.');
}
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  logger.warn('⚠️  FRONTEND_URL is missing in production.');
}

// 1. Base Processing Middlewares
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// 2. Security Configuration & Refined CORS Rules
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
  'https://usepaylio.vercel.app', 
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
  allowedHeaders: ['Content-Type', 'Authorization', 'apollo-require-preflight', 'x-apollo-operation-name'],
  // 🟢 FIXED: Re-added to allow client engines to process cookie handoffs successfully cross-port
  exposedHeaders: ['set-cookie'],
}));

// 3. Rate Limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many authentication requests, please try again later.' },
  validate: false,
  keyGenerator: (req) => `${req.ip}:${req.path}`,
});

const restLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  validate: false,
});

const gqlLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many GraphQL engine requests, please try again later.' },
  validate: false,
});

// 4. Router Integrations
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/', restLimiter);

// Multi-tenant operational path routing
app.use('/api/payroll', authMiddleware, payrollRoutes);
app.use('/api/employees', authMiddleware, employeeRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/reports', authMiddleware, reportRoutes);
app.use('/api/payslips', authMiddleware, payslipRoutes);
app.use('/api/tenants', authMiddleware, tenantRoutes);
app.use('/api/companies', authMiddleware, tenantBrandingRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);

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
      
      const baseContext = { userId: null, companyId: null, userRole: null, isSuperAdmin: false, prisma, loaders: createLoaders() };
      if (!token) return baseContext;

      try {
        const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        const isSuper = payload.role === 'SUPER_ADMIN';
        return {
          userId: payload.userId,
          companyId: isSuper ? null : payload.companyId,
          userRole: payload.role,
          isSuperAdmin: isSuper,
          prisma,
          loaders: createLoaders(),
        };
      } catch (err) {
        logger.error('Subscription Auth Extraction Error', { message: err.message });
        return baseContext;
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
          let authContext = { userId: null, companyId: null, userRole: null, isSuperAdmin: false };
          
          try {
            authContext = authMiddlewareGraphQL(req);
            if (authContext.userRole === 'SUPER_ADMIN') {
              authContext.companyId = null;
              authContext.isSuperAdmin = true;
            }
          } catch (err) {
            logger.error('GraphQL middleware isolation error:', { message: err.message });
          }

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
        logger.error('Health system connection dropped', { message: e.message });
        res.status(503).json({ status: 'DOWN', database: 'error' });
      }
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} context received. Graceful shutdown active...`);
      await apolloServer.stop();
      await prisma.$disconnect();
      if (wsServer) wsServer.close();
      httpServer.close(() => {
        logger.info('Process complete.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      logger.info(`🚀 Stack live at http://localhost:${PORT}/graphql`);
    });
  } catch (err) {
    logger.error('Apollo Engine crash during startup sequence:', { stack: err.stack });
    process.exit(1);
  }
})();