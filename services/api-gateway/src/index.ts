import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import { config } from './config';
import { logger } from './utils/logger';
import { RedisClient } from './services/redis.service';
import { setupTelemetry } from './utils/telemetry';
import eventRoutes from './routes/events.routes';
import authRoutes from './routes/auth.routes';
import healthRoutes from './routes/health.routes';

// Setup OpenTelemetry
setupTelemetry();

// Initialize Fastify
const fastify = Fastify({
  logger: logger,
  requestIdLogLabel: 'traceId',
  disableRequestLogging: false,
  trustProxy: true,
});

// Register plugins
async function registerPlugins() {
  // CORS
  await fastify.register(cors, {
    origin: config.corsOrigins.split(','),
    credentials: true,
  });

  // Helmet for security headers
  if (config.helmetEnabled) {
    await fastify.register(helmet, {
      contentSecurityPolicy: false,
    });
  }

  // JWT Authentication
  await fastify.register(jwt, {
    secret: config.jwtSecret,
    sign: {
      expiresIn: config.jwtExpiry,
    },
  });

  // Rate Limiting
  await fastify.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    redis: RedisClient.getInstance(),
    skipOnError: false,
    keyGenerator: (request) => {
      return request.headers['x-forwarded-for'] as string || 
             request.ip || 
             'unknown';
    },
  });
}

// Register routes
async function registerRoutes() {
  await fastify.register(healthRoutes, { prefix: '/health' });
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(eventRoutes, { prefix: '/events' });
}

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  request.log.error({
    error: error.message,
    stack: error.stack,
    url: request.url,
    method: request.method,
  });

  const statusCode = error.statusCode || 500;
  const message = statusCode >= 500 ? 'Internal Server Error' : error.message;

  reply.status(statusCode).send({
    success: false,
    error: {
      message,
      code: error.code || 'INTERNAL_ERROR',
    },
  });
});

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    try {
      await fastify.close();
      await RedisClient.disconnect();
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
});

// Start server
async function start() {
  try {
    // Connect to Redis
    await RedisClient.connect();
    logger.info('✅ Connected to Redis');

    // Register plugins and routes
    await registerPlugins();
    await registerRoutes();

    // Start listening
    await fastify.listen({
      port: config.apiPort,
      host: config.apiHost,
    });

    logger.info(`🚀 API Gateway running on http://${config.apiHost}:${config.apiPort}`);
    logger.info(`📊 Environment: ${config.nodeEnv}`);
    logger.info(`🔒 Rate limit: ${config.rateLimitMax} requests per ${config.rateLimitWindow}ms`);
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

export default fastify;
