import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPort: parseInt(process.env.API_PORT || '3000', 10),
  apiHost: process.env.API_HOST || '0.0.0.0',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiry: process.env.JWT_EXPIRY || '1h',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',

  // Rate Limiting
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  redisStreamName: process.env.REDIS_STREAM_NAME || 'user.events',
  redisPassword: process.env.REDIS_PASSWORD || undefined,

  // Security
  corsOrigins: process.env.CORS_ORIGINS || 'http://localhost:3001',
  helmetEnabled: process.env.HELMET_ENABLED === 'true',

  // Observability
  otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
  logLevel: process.env.LOG_LEVEL || 'info',
  logFormat: process.env.LOG_FORMAT || 'json',
} as const;

// Validation
if (config.nodeEnv === 'production' && config.jwtSecret === 'change-me-in-production') {
  throw new Error('JWT_SECRET must be set in production!');
}

export type Config = typeof config;
