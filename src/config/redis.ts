import { createClient } from 'redis';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

// Command client. Pub/sub subscribers must use redisClient.duplicate().
export const redisClient = createClient({ url: env.REDIS_URL });

redisClient.on('error', (err: unknown) => logger.error({ err }, 'redis error'));
redisClient.on('reconnecting', () => logger.warn('redis reconnecting'));
