import { app } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { checkDatabase, sql } from '@/config/database';
import { redisClient } from '@/config/redis';

const start = async (): Promise<void> => {
  await checkDatabase();
  logger.info('postgres connected');
  await redisClient.connect();
  logger.info('redis connected');

  const server = app.listen(env.PORT, () => logger.info(`server listening on :${env.PORT}`));

  const shutdown = (signal: string): void => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await Promise.allSettled([sql.end({ timeout: 5 }), redisClient.quit()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled rejection');
  process.exit(1);
});

start().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
