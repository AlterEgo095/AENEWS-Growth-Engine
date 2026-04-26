import Redis from 'ioredis';
import axios, { AxiosInstance } from 'axios';
import CircuitBreaker from 'opossum';
import pino from 'pino';

// ============================================
// CONFIGURATION
// ============================================
const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  },
  mautic: {
    baseUrl: process.env.MAUTIC_BASE_URL || 'http://localhost:8080',
    apiUrl: process.env.MAUTIC_API_URL || 'http://localhost:8080/api',
    username: process.env.MAUTIC_USERNAME || 'admin',
    password: process.env.MAUTIC_PASSWORD || 'MauticAdmin2024!',
  },
  streams: {
    mauticEvents: 'mautic.events',
    consumerGroup: process.env.CONSUMER_GROUP || 'mautic-service-group',
    consumerName: process.env.CONSUMER_NAME || `mautic-service-${process.pid}`,
  },
  processing: {
    batchSize: parseInt(process.env.BATCH_SIZE || '50'),
    blockTime: parseInt(process.env.BLOCK_TIME_MS || '5000'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.RETRY_DELAY_MS || '2000'),
  },
  cache: {
    contactIdTTL: parseInt(process.env.CONTACT_ID_TTL || '3600'),
  },
  circuitBreaker: {
    timeout: parseInt(process.env.CB_TIMEOUT || '10000'),
    errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD || '50'),
    resetTimeout: parseInt(process.env.CB_RESET_TIMEOUT || '30000'),
  },
};

// ============================================
// LOGGER
// ============================================
const logger = pino({
  name: 'mautic-integration-service',
  level: process.env.LOG_LEVEL || 'info',
});

// ============================================
// REDIS CLIENT
// ============================================
let redisClient: Redis;
let cacheClient: Redis;

function initRedis(): void {
  redisClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis error');
  });

  // Separate client for caching
  cacheClient = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
  });
}

// ============================================
// MAUTIC API CLIENT
// ============================================
let mauticClient: AxiosInstance;

function initMauticClient(): void {
  mauticClient = axios.create({
    baseURL: config.mautic.apiUrl,
    timeout: 10000,
    auth: {
      username: config.mautic.username,
      password: config.mautic.password,
    },
    headers: {
      'Content-Type': 'application/json',
    },
  });

  logger.info('Mautic API client initialized');
}

// ============================================
// CIRCUIT BREAKER WRAPPER
// ============================================
interface CircuitBreakerOptions {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
}

function createCircuitBreaker<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  name: string
): CircuitBreaker<T, R> {
  const options: CircuitBreakerOptions = {
    timeout: config.circuitBreaker.timeout,
    errorThresholdPercentage: config.circuitBreaker.errorThresholdPercentage,
    resetTimeout: config.circuitBreaker.resetTimeout,
  };

  const breaker = new CircuitBreaker(fn, options);

  breaker.on('open', () => {
    logger.warn({ name }, 'Circuit breaker opened');
  });

  breaker.on('halfOpen', () => {
    logger.info({ name }, 'Circuit breaker half-open');
  });

  breaker.on('close', () => {
    logger.info({ name }, 'Circuit breaker closed');
  });

  return breaker;
}

// ============================================
// CONTACT ID CACHE
// ============================================
async function getCachedContactId(userId: string): Promise<string | null> {
  const cacheKey = `mautic:contact:${userId}`;
  const contactId = await cacheClient.get(cacheKey);
  return contactId;
}

async function setCachedContactId(userId: string, contactId: string): Promise<void> {
  const cacheKey = `mautic:contact:${userId}`;
  await cacheClient.setex(cacheKey, config.cache.contactIdTTL, contactId);
}

// ============================================
// MAUTIC API OPERATIONS
// ============================================

// Get or create contact
async function getOrCreateContact(userData: any): Promise<string> {
  const { userId, email, firstName, lastName } = userData;

  // Check cache first
  const cachedId = await getCachedContactId(userId);
  if (cachedId) {
    logger.debug({ userId, contactId: cachedId }, 'Contact ID from cache');
    return cachedId;
  }

  try {
    // Search by email
    if (email) {
      const searchResponse = await mauticClient.get('/contacts', {
        params: {
          search: `email:${email}`,
        },
      });

      if (searchResponse.data.contacts && Object.keys(searchResponse.data.contacts).length > 0) {
        const contactId = Object.keys(searchResponse.data.contacts)[0];
        await setCachedContactId(userId, contactId);
        logger.info({ userId, contactId, email }, 'Contact found');
        return contactId;
      }
    }

    // Create new contact
    const createResponse = await mauticClient.post('/contacts/new', {
      email: email || `${userId}@unknown.local`,
      firstname: firstName,
      lastname: lastName,
      tags: ['aenews-growth-engine'],
      fields: {
        all: {
          external_id: userId,
        },
      },
    });

    const contactId = createResponse.data.contact.id.toString();
    await setCachedContactId(userId, contactId);
    logger.info({ userId, contactId }, 'Contact created');
    return contactId;
  } catch (error: any) {
    logger.error({ error: error.message, userId }, 'Failed to get or create contact');
    throw error;
  }
}

const getOrCreateContactBreaker = createCircuitBreaker(getOrCreateContact, 'getOrCreateContact');

// Track event in Mautic
async function trackEvent(contactId: string, eventType: string, eventData: any): Promise<void> {
  try {
    await mauticClient.post(`/contacts/${contactId}/events/add`, {
      event: eventType,
      eventType: 'custom',
      data: eventData,
    });

    logger.debug({ contactId, eventType }, 'Event tracked in Mautic');
  } catch (error: any) {
    logger.error({ error: error.message, contactId, eventType }, 'Failed to track event');
    throw error;
  }
}

const trackEventBreaker = createCircuitBreaker(trackEvent, 'trackEvent');

// Update contact tags/segments
async function updateContactTags(contactId: string, tags: string[]): Promise<void> {
  try {
    await mauticClient.post(`/contacts/${contactId}/tags/add`, {
      tags,
    });

    logger.debug({ contactId, tags }, 'Tags updated');
  } catch (error: any) {
    logger.error({ error: error.message, contactId }, 'Failed to update tags');
    throw error;
  }
}

const updateContactTagsBreaker = createCircuitBreaker(updateContactTags, 'updateContactTags');

// ============================================
// BATCH PROCESSING
// ============================================
interface MauticEvent {
  eventId: string;
  userId: string;
  eventType: string;
  timestamp: number;
  payload: any;
}

async function processBatch(events: MauticEvent[]): Promise<void> {
  logger.info({ count: events.length }, 'Processing batch');

  const results = await Promise.allSettled(
    events.map(async (event) => {
      try {
        // Get/create contact
        const contactId = await getOrCreateContactBreaker.fire(event.payload);

        // Track event
        await trackEventBreaker.fire(contactId, event.eventType, {
          eventId: event.eventId,
          timestamp: event.timestamp,
          ...event.payload,
        });

        // Update tags if present
        if (event.payload.tags && Array.isArray(event.payload.tags)) {
          await updateContactTagsBreaker.fire(contactId, event.payload.tags);
        }

        return { success: true, eventId: event.eventId };
      } catch (error: any) {
        logger.error({ error: error.message, eventId: event.eventId }, 'Failed to process event');
        return { success: false, eventId: event.eventId, error: error.message };
      }
    })
  );

  const successful = results.filter((r) => r.status === 'fulfilled' && (r.value as any).success).length;
  const failed = results.length - successful;

  logger.info({ successful, failed, total: results.length }, 'Batch processed');
}

// ============================================
// CONSUMER GROUP SETUP
// ============================================
async function ensureConsumerGroup(streamKey: string, groupName: string): Promise<void> {
  try {
    await redisClient.xgroup('CREATE', streamKey, groupName, '0', 'MKSTREAM');
    logger.info({ streamKey, groupName }, 'Consumer group created');
  } catch (err: any) {
    if (err.message.includes('BUSYGROUP')) {
      logger.info({ streamKey, groupName }, 'Consumer group already exists');
    } else {
      throw err;
    }
  }
}

// ============================================
// PROCESS PENDING MESSAGES (RETRY MECHANISM)
// ============================================
async function processPendingMessages(): Promise<void> {
  try {
    const pending: any = await redisClient.xpending(
      config.streams.mauticEvents,
      config.streams.consumerGroup,
      '-',
      '+',
      10
    );

    if (!pending || !Array.isArray(pending) || pending.length === 0) {
      return;
    }

    logger.info({ count: pending.length }, 'Processing pending messages');

    for (const msg of pending) {
      const [id, consumer, idleTime, deliveryCount] = msg;

      // Move to DLQ if max retries exceeded
      if (typeof deliveryCount === 'number' && deliveryCount > config.processing.maxRetries) {
        logger.warn({ id, deliveryCount }, 'Message exceeded max retries, moving to DLQ');

        const messages: any = await redisClient.xclaim(
          config.streams.mauticEvents,
          config.streams.consumerGroup,
          config.streams.consumerName,
          0,
          id
        );

        if (messages && Array.isArray(messages) && messages.length > 0) {
          const [msgId, fields] = messages[0];

          // Move to dead letter queue
          const fieldsArray: string[] = [];
          for (const [key, value] of Object.entries(fields)) {
            fieldsArray.push(key, String(value));
          }
          await redisClient.xadd('dlq.mautic', '*', ...fieldsArray);

          // ACK original message
          await redisClient.xack(config.streams.mauticEvents, config.streams.consumerGroup, msgId);
        }

        continue;
      }

      // Retry if idle time exceeds delay
      if (typeof idleTime === 'number' && idleTime > config.processing.retryDelay) {
        const messages: any = await redisClient.xclaim(
          config.streams.mauticEvents,
          config.streams.consumerGroup,
          config.streams.consumerName,
          config.processing.retryDelay,
          id
        );

        if (messages && Array.isArray(messages) && messages.length > 0) {
          const [msgId, fields] = messages[0];
          const event: MauticEvent = JSON.parse(fields.eventData);
          await processBatch([event]);
          await redisClient.xack(config.streams.mauticEvents, config.streams.consumerGroup, msgId);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error processing pending messages');
  }
}

// ============================================
// MAIN CONSUMER LOOP
// ============================================
async function startConsumer(): Promise<void> {
  logger.info('Starting Mautic integration consumer');

  // Process pending messages every 30 seconds
  setInterval(() => {
    processPendingMessages().catch((err) => {
      logger.error({ err }, 'Error in pending message processor');
    });
  }, 30000);

  while (true) {
    try {
      // @ts-ignore
      const results: any = await redisClient.xreadgroup(
        'GROUP',
        config.streams.consumerGroup,
        config.streams.consumerName,
        'BLOCK',
        config.processing.blockTime.toString(),
        'COUNT',
        config.processing.batchSize.toString(),
        'STREAMS',
        config.streams.mauticEvents,
        '>'
      );

      if (!results || results.length === 0) {
        continue;
      }

      const [streamKey, messages] = results[0];

      logger.info({ streamKey, count: messages.length }, 'Received batch');

      // Parse events
      const events: MauticEvent[] = messages.map(([id, fields]: any) => {
        return JSON.parse(fields.eventData);
      });

      // Process batch
      await processBatch(events);

      // ACK all messages
      const messageIds = messages.map(([id]: any) => id);
      if (messageIds.length > 0) {
        await redisClient.xack(config.streams.mauticEvents, config.streams.consumerGroup, ...messageIds);
      }
    } catch (err) {
      logger.error({ err }, 'Error in consumer loop');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
async function shutdown(): Promise<void> {
  logger.info('Shutting down gracefully');

  if (redisClient) {
    await redisClient.quit();
  }

  if (cacheClient) {
    await cacheClient.quit();
  }

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================
// MAIN
// ============================================
(async () => {
  try {
    logger.info('Initializing Mautic Integration Service');

    // Init clients
    initRedis();
    initMauticClient();

    // Wait for Redis connection
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Setup consumer group
    await ensureConsumerGroup(config.streams.mauticEvents, config.streams.consumerGroup);

    // Start consuming
    await startConsumer();
  } catch (err) {
    logger.fatal({ err }, 'Fatal error during startup');
    process.exit(1);
  }
})();
