import { FastifyInstance, FastifyReply, FastifyRequest, RouteGenericInterface } from 'fastify';
import { RedisClient } from '../services/redis.service';
import { UserEventSchema, BatchEventsSchema, UserEvent } from '../schemas/event.schema';
import { trace, context } from '@opentelemetry/api';

const tracer = trace.getTracer('api-gateway');

export default async function eventRoutes(fastify: FastifyInstance) {
  
  // Single event endpoint
  fastify.post('/track', {
    schema: {
      description: 'Track a single user event',
      tags: ['events'],
      body: UserEventSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            eventId: { type: 'string' },
          },
        },
      },
    },
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.code(401).send({ 
          success: false, 
          error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } 
        });
      }
    },
  }, async (request, reply) => {
    const span = tracer.startSpan('track-event', {}, context.active());
    
    try {
      const event = request.body as UserEvent;
      
      // Enrich event with request context
      const enrichedEvent = {
        ...event,
        timestamp: event.timestamp || Date.now(),
        context: {
          ...event.context,
          ip: event.context?.ip || request.ip,
          userAgent: event.context?.userAgent || request.headers['user-agent'],
        },
        metadata: {
          receivedAt: Date.now(),
          traceId: request.id,
        },
      };

      // Publish to Redis Stream
      const eventId = await RedisClient.publishEvent(enrichedEvent);

      span.setAttributes({
        'event.type': event.type,
        'event.id': eventId,
        'user.id': event.userId || 'anonymous',
      });

      request.log.info({ eventId, type: event.type }, 'Event tracked successfully');

      return reply.code(200).send({
        success: true,
        eventId,
      });
    } catch (error: any) {
      span.recordException(error);
      request.log.error({ error }, 'Failed to track event');
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to track event', code: 'TRACKING_ERROR' },
      });
    } finally {
      span.end();
    }
  });

  // Batch events endpoint
  fastify.post('/batch', {
    schema: {
      description: 'Track multiple user events in batch',
      tags: ['events'],
      body: BatchEventsSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            eventsProcessed: { type: 'number' },
            eventIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.code(401).send({ 
          success: false, 
          error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } 
        });
      }
    },
  }, async (request, reply) => {
    const span = tracer.startSpan('track-batch-events', {}, context.active());
    
    try {
      const { events } = request.body as { events: UserEvent[] };
      
      // Process events in parallel
      const eventIds = await Promise.all(
        events.map(async (event) => {
          const enrichedEvent = {
            ...event,
            timestamp: event.timestamp || Date.now(),
            context: {
              ...event.context,
              ip: event.context?.ip || request.ip,
              userAgent: event.context?.userAgent || request.headers['user-agent'],
            },
            metadata: {
              receivedAt: Date.now(),
              traceId: request.id,
            },
          };
          
          return await RedisClient.publishEvent(enrichedEvent);
        })
      );

      span.setAttributes({
        'events.count': events.length,
        'events.processed': eventIds.length,
      });

      request.log.info({ count: events.length }, 'Batch events tracked successfully');

      return reply.code(200).send({
        success: true,
        eventsProcessed: eventIds.length,
        eventIds,
      });
    } catch (error: any) {
      span.recordException(error);
      request.log.error({ error }, 'Failed to track batch events');
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to track batch events', code: 'BATCH_TRACKING_ERROR' },
      });
    } finally {
      span.end();
    }
  });

  // Public tracking pixel endpoint (no auth required)
  fastify.get('/pixel.gif', {
    schema: {
      description: 'Tracking pixel for email opens',
      tags: ['events'],
      querystring: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          e: { type: 'string' }, // email
          c: { type: 'string' }, // campaign
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { id, e, c } = request.query as { id?: string; e?: string; c?: string };
      
      if (id || e) {
        const event = {
          type: 'email_open',
          userId: id,
          email: e,
          properties: {
            campaign: c,
          },
          context: {
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          },
          timestamp: Date.now(),
        };
        
        await RedisClient.publishEvent(event);
      }
      
      // Return 1x1 transparent GIF
      const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
      );
      
      return reply
        .code(200)
        .header('Content-Type', 'image/gif')
        .header('Cache-Control', 'no-cache, no-store, must-revalidate')
        .header('Pragma', 'no-cache')
        .header('Expires', '0')
        .send(pixel);
    } catch (error) {
      request.log.error({ error }, 'Failed to track pixel');
      // Still return pixel even on error
      const pixel = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
      );
      return reply
        .code(200)
        .header('Content-Type', 'image/gif')
        .send(pixel);
    }
  });
}
