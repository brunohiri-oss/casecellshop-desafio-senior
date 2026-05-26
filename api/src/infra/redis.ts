import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  logger.error({ err }, 'redis error');
});

redis.on('connect', () => {
  logger.info('redis connected');
});

// BullMQ requires its own connection with maxRetriesPerRequest=null
export function createBullConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (err) {
    logger.error({ err }, 'redis ping failed');
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
