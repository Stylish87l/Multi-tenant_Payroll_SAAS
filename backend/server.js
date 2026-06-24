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
import { createLoaders } from './graphql/resolvers.js';

// Routes & GraphQL
import authRouter from './routes/auth.js';
import payrollRoutes from './routes/payroll.js';
import typeDefs from './graphql/typeDefs.js';
import resolvers from './graphql/resolvers.js';

const app = express();
const httpServer = http.createServer(app);

// 1. Core Middlewares: Cookie parser MUST be before routes
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Debug incoming cookies (keep for one run to verify iMac detection)
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

// FIX: Removed conflicting 'origin: true' line to prevent browser blocking
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'https://studio.apollographql.com',
  'https://sandbox.embed.apollographql.com',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // This allows the 'refreshToken' cookie to pass
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
});

const gqlLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many GraphQL requests, please try again later.' },
});

// 4. REST Routes
app.use('/api/', restLimiter);
app.use('/api/auth', authRouter);
app.use('/api/payroll', authMiddleware, payrollRoutes);

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
          let authContext = { userId: null, companyId: null, userRole: null };

          try {
            const authHeader = req.headers.authorization || '';
            if (authHeader.startsWith('Bearer ')) {
              const token = authHeader.split(' ')[1];
              const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

              authContext = {
                userId: decoded.userId,
                companyId: decoded.companyId || req.headers['x-tenant-id'] || null,
                userRole: decoded.role,
              };
            }

            return {
              ...authContext,
              prisma,
              loaders: createLoaders(),
              req,
              res, // Pass res to resolvers for cookie management
            };
          } catch (error) {
            logger.error('GraphQL Context Error', { message: error.message });
            return {
              userId: null,
              companyId: null,
              userRole: null,
              prisma,
              loaders: createLoaders(),
              req,
              res,
            };
          }
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