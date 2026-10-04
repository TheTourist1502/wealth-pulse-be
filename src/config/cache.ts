import { logger } from '@/config/logger';
import { redisClient } from '@/config/redis';

// JSON cache over Redis. Failures are logged and treated as a miss: the cache must never fail a request.
export const cacheService = {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const value = await redisClient.get(key);
      return value === null ? undefined : (JSON.parse(value) as T);
    } catch (err) {
      logger.warn({ err, key }, 'cache get failed');
      return undefined;
    }
  },

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (err) {
      logger.warn({ err, key }, 'cache set failed');
    }
  },

  async delete(key: string): Promise<void> {
    try {
      await redisClient.del(key);
    } catch (err) {
      logger.warn({ err, key }, 'cache delete failed');
    }
  },

  // SCAN + DEL, never KEYS.
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) await redisClient.del(key);
    } catch (err) {
      logger.warn({ err, pattern }, 'cache invalidate failed');
    }
  },
};

// Read-through helper: return the cached value or load, store and return it.
export const cached = async <T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> => {
  const hit = await cacheService.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  await cacheService.set(key, value, ttlSeconds);
  return value;
};
