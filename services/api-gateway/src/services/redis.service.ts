import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

export class RedisClient {
  private static instance: Redis;
  private static streamClient: Redis;

  static getInstance(): Redis {
    if (!RedisClient.instance) {
      RedisClient.instance = new Redis(config.redisUrl, {
        password: config.redisPassword,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      RedisClient.instance.on('connect', () => {
        logger.info('Redis client connected');
      });

      RedisClient.instance.on('error', (err: Error) => {
        logger.error({ err }, 'Redis error');
      });
    }
    return RedisClient.instance;
  }

  static getStreamClient(): Redis {
    if (!RedisClient.streamClient) {
      RedisClient.streamClient = new Redis(config.redisUrl, {
        password: config.redisPassword,
        enableAutoPipelining: true,
      });
    }
    return RedisClient.streamClient;
  }

  static async publishEvent(event: any): Promise<string> {
    const streamClient = RedisClient.getStreamClient();
    
    try {
      const eventId: string = await streamClient.xadd(
        config.redisStreamName,
        'MAXLEN', '~', '100000', // Keep last 100k events
        '*', // Auto-generate ID
        'data', JSON.stringify(event),
        'timestamp', Date.now().toString(),
        'type', event.type || 'unknown',
      ) as string;

      logger.debug({ eventId, type: event.type }, 'Event published to stream');
      return eventId;
    } catch (error) {
      logger.error({ error, event }, 'Failed to publish event');
      throw error;
    }
  }

  static async connect(): Promise<void> {
    const client = RedisClient.getInstance();
    await client.ping();
  }

  static async disconnect(): Promise<void> {
    if (RedisClient.instance) {
      await RedisClient.instance.quit();
    }
    if (RedisClient.streamClient) {
      await RedisClient.streamClient.quit();
    }
  }
}
