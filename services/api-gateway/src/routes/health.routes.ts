import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RedisClient } from '../services/redis.service';

export default async function healthRoutes(fastify: FastifyInstance) {
  
  // Liveness probe
  fastify.get('/live', {
    schema: {
      description: 'Liveness probe for Kubernetes',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      status: 'ok',
    });
  });

  // Readiness probe
  fastify.get('/ready', {
    schema: {
      description: 'Readiness probe for Kubernetes',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: {
              type: 'object',
              properties: {
                redis: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check Redis connection
      const redis = RedisClient.getInstance();
      await redis.ping();
      
      return reply.code(200).send({
        status: 'ok',
        checks: {
          redis: 'connected',
        },
      });
    } catch (error: any) {
      request.log.error({ error }, 'Readiness check failed');
      return reply.code(503).send({
        status: 'error',
        checks: {
          redis: 'disconnected',
        },
      });
    }
  });

  // Detailed health endpoint
  fastify.get('/', {
    schema: {
      description: 'Detailed health status',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'number' },
            uptime: { type: 'number' },
            version: { type: 'string' },
            checks: {
              type: 'object',
              properties: {
                redis: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    latency: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check Redis with latency
      const redis = RedisClient.getInstance();
      const startTime = Date.now();
      await redis.ping();
      const redisLatency = Date.now() - startTime;
      
      return reply.code(200).send({
        status: 'healthy',
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        checks: {
          redis: {
            status: 'connected',
            latency: redisLatency,
          },
        },
      });
    } catch (error: any) {
      request.log.error({ error }, 'Health check failed');
      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        checks: {
          redis: {
            status: 'disconnected',
            latency: -1,
          },
        },
      });
    }
  });
}
