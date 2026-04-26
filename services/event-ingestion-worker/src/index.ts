import Redis from 'ioredis';
import { MongoClient, Db } from 'mongodb';
import * as crypto from 'crypto';
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
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://admin:MongoPass2024!@localhost:27017',
    database: process.env.MONGODB_DATABASE || 'aenews',
  },
  streams: {
    userEvents: process.env.REDIS_STREAM_USER_EVENTS || 'user.events',
    aiDecisions: process.env.REDIS_STREAM_AI_DECISIONS || 'ai.decisions',
    consumerGroup: process.env.CONSUMER_GROUP || 'event-worker-group',
    consumerName: process.env.CONSUMER_NAME || `event-worker-${process.pid}`,
  },
  processing: {
    batchSize: parseInt(process.env.BATCH_SIZE || '10'),
    blockTime: parseInt(process.env.BLOCK_TIME_MS || '5000'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.RETRY_DELAY_MS || '1000'),
  },
};

// ============================================
// LOGGER
// ============================================
const logger = pino({
  name: 'event-ingestion-worker',
  level: process.env.LOG_LEVEL || 'info',
});

// ============================================
// REDIS CLIENT
// ============================================
let redisClient: Redis;

function initRedis(): Redis {
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      logger.warn(`Redis reconnect attempt ${times}, delay ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: null,
  });

  client.on('error', (err) => logger.error({ err }, 'Redis error'));
  client.on('connect', () => logger.info('Redis connected'));
  client.on('ready', () => logger.info('Redis ready'));

  return client;
}

// ============================================
// MONGODB CLIENT
// ============================================
let mongoClient: MongoClient;
let db: Db;

async function initMongoDB(): Promise<void> {
  mongoClient = new MongoClient(config.mongodb.uri);
  await mongoClient.connect();
  db = mongoClient.db(config.mongodb.database);
  
  // Create indexes for performance
  await db.collection('events').createIndex({ eventId: 1 }, { unique: true });
  await db.collection('events').createIndex({ eventType: 1, timestamp: -1 });
  await db.collection('events').createIndex({ userId: 1, timestamp: -1 });
  await db.collection('events').createIndex({ eventHash: 1 });
  
  // TTL index: delete events older than 90 days
  await db.collection('events').createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
  );
  
  logger.info('MongoDB connected and indexes created');
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
// EVENT ENRICHMENT
// ============================================
interface RawEvent {
  eventId: string;
  eventType: string;
  userId: string;
  timestamp: number;
  payload: string;
  [key: string]: any;
}

interface EnrichedEvent {
  eventId: string;
  eventType: string;
  userId: string;
  timestamp: number;
  payload: any;
  eventHash: string;
  enrichment: {
    receivedAt: Date;
    processedAt: Date;
    source: string;
    geoIp?: any;
    userAgent?: any;
  };
  metadata: {
    retryCount: number;
    processingDuration: number;
  };
}

function enrichEvent(raw: RawEvent): EnrichedEvent {
  const startTime = Date.now();
  
  // Parse payload
  let payload: any;
  try {
    payload = typeof raw.payload === 'string' ? JSON.parse(raw.payload) : raw.payload;
  } catch {
    payload = raw.payload;
  }
  
  // Generate hash for deduplication
  const eventHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ userId: raw.userId, eventType: raw.eventType, timestamp: raw.timestamp }))
    .digest('hex');
  
  return {
    eventId: raw.eventId,
    eventType: raw.eventType,
    userId: raw.userId,
    timestamp: raw.timestamp,
    payload,
    eventHash,
    enrichment: {
      receivedAt: new Date(raw.timestamp),
      processedAt: new Date(),
      source: payload.source || 'api',
      geoIp: payload.ip ? { ip: payload.ip } : undefined,
      userAgent: payload.userAgent,
    },
    metadata: {
      retryCount: 0,
      processingDuration: Date.now() - startTime,
    },
  };
}

// ============================================
// STORE EVENT IN DATA LAKE
// ============================================
async function storeEventInDataLake(event: EnrichedEvent): Promise<void> {
  try {
    await db.collection('events').insertOne({
      ...event,
      createdAt: new Date(),
    });
    logger.debug({ eventId: event.eventId }, 'Event stored in data lake');
  } catch (err: any) {
    if (err.code === 11000) {
      // Duplicate event (already processed)
      logger.warn({ eventId: event.eventId, eventHash: event.eventHash }, 'Duplicate event detected, skipping');
    } else {
      throw err;
    }
  }
}

// ============================================
// FORWARD TO MAUTIC
// ============================================
async function forwardToMautic(event: EnrichedEvent): Promise<void> {
  const mauticEvent = {
    eventId: event.eventId,
    userId: event.userId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    payload: event.payload,
  };
  
  // Push to mautic.events stream
  await redisClient.xadd(
    'mautic.events',
    '*',
    'eventData',
    JSON.stringify(mauticEvent)
  );
  
  logger.debug({ eventId: event.eventId }, 'Event forwarded to Mautic stream');
}

// ============================================
// FORWARD TO AI ENGINE
// ============================================
async function forwardToAI(event: EnrichedEvent): Promise<void> {
  // Only send certain event types to AI
  const aiEligibleTypes = ['page_view', 'form_submit', 'email_open', 'email_click', 'purchase'];
  
  if (!aiEligibleTypes.includes(event.eventType)) {
    return;
  }
  
  const aiEvent = {
    eventId: event.eventId,
    userId: event.userId,
    eventType: event.eventType,
    payload: event.payload,
    enrichment: event.enrichment,
  };
  
  await redisClient.xadd(
    config.streams.aiDecisions,
    '*',
    'eventData',
    JSON.stringify(aiEvent)
  );
  
  logger.debug({ eventId: event.eventId }, 'Event forwarded to AI stream');
}

// ============================================
// PROCESS SINGLE EVENT
// ============================================
async function processEvent(streamId: string, fields: any): Promise<void> {
  const startTime = Date.now();
  
  try {
    // Parse event data
    const rawEvent: RawEvent = JSON.parse(fields.eventData);
    
    logger.info({ eventId: rawEvent.eventId, eventType: rawEvent.eventType }, 'Processing event');
    
    // Enrich
    const enrichedEvent = enrichEvent(rawEvent);
    
    // Store in data lake
    await storeEventInDataLake(enrichedEvent);
    
    // Forward to Mautic
    await forwardToMautic(enrichedEvent);
    
    // Forward to AI
    await forwardToAI(enrichedEvent);
    
    // ACK message
    await redisClient.xack(config.streams.userEvents, config.streams.consumerGroup, streamId);
    
    const duration = Date.now() - startTime;
    logger.info({ eventId: rawEvent.eventId, duration }, 'Event processed successfully');
    
  } catch (err: any) {
    logger.error({ err, streamId }, 'Error processing event');
    // Event will be retried by pending message handler
    throw err;
  }
}

// ============================================
// PROCESS PENDING MESSAGES (DEAD LETTER QUEUE)
// ============================================
async function processPendingMessages(): Promise<void> {
  try {
    const pending = await redisClient.xpending(
      config.streams.userEvents,
      config.streams.consumerGroup,
      '-',
      '+',
      10
    );
    
    if (!pending || pending.length === 0 || !Array.isArray(pending)) {
      return;
    }
    
    logger.info({ count: pending.length }, 'Processing pending messages');
    
    for (const msg of pending) {
      const [id, consumer, idleTime, deliveryCount] = msg;
      
      // If message has been retried too many times, move to DLQ
      if (deliveryCount > config.processing.maxRetries) {
        logger.warn({ id, deliveryCount }, 'Message exceeded max retries, moving to DLQ');
        
        const messages: any = await redisClient.xclaim(
          config.streams.userEvents,
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
          await redisClient.xadd('dlq.events', '*', ...fieldsArray);
          
          // ACK original message
          await redisClient.xack(config.streams.userEvents, config.streams.consumerGroup, msgId);
        }
        
        continue;
      }
      
      // Claim and retry
      if (typeof idleTime === 'number' && idleTime > config.processing.retryDelay) {
        const messages: any = await redisClient.xclaim(
          config.streams.userEvents,
          config.streams.consumerGroup,
          config.streams.consumerName,
          config.processing.retryDelay,
          id
        );
        
        if (messages && Array.isArray(messages) && messages.length > 0) {
          const [msgId, fields] = messages[0];
          await processEvent(msgId, fields);
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
  logger.info('Starting event consumer');
  
  // Process pending messages every 30 seconds
  setInterval(() => {
    processPendingMessages().catch((err) => {
      logger.error({ err }, 'Error in pending message processor');
    });
  }, 30000);
  
  while (true) {
    try {
      const results: any = await redisClient.xreadgroup(
        'GROUP',
        config.streams.consumerGroup,
        config.streams.consumerName,
        'BLOCK',
        config.processing.blockTime.toString(),
        'COUNT',
        config.processing.batchSize.toString(),
        'STREAMS',
        config.streams.userEvents,
        '>'
      );
      
      if (!results || results.length === 0) {
        continue;
      }
      
      const [streamKey, messages] = results[0];
      
      logger.info({ streamKey, count: messages.length }, 'Received batch');
      
      // Process messages in parallel
      await Promise.allSettled(
        messages.map(([id, fields]: any) => processEvent(id, fields))
      );
      
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
  
  if (mongoClient) {
    await mongoClient.close();
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
    logger.info('Initializing Event Ingestion Worker');
    
    // Init connections
    redisClient = initRedis();
    await initMongoDB();
    
    // Setup consumer group
    await ensureConsumerGroup(config.streams.userEvents, config.streams.consumerGroup);
    
    // Start consuming
    await startConsumer();
    
  } catch (err) {
    logger.fatal({ err }, 'Fatal error during startup');
    process.exit(1);
  }
})();
