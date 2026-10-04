import { app } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { checkDatabase, sql } from '@/config/database';
import { redisClient } from '@/config/redis';
import { startJobs } from '@/jobs';
import { closeQueues } from '@/jobs/queues';
import { initSocket } from '@/websocket/server';

const start = async (): Promise<void> => {
  await checkDatabase();
  logger.info('postgres connected');
  await redisClient.connect();
  logger.info('redis connected');

  const server = app.listen(env.PORT, () => logger.info(`server listening on :${env.PORT}`));
  const closeSocket = await initSocket(server);
  await startJobs();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), 10_000).unref();
    await closeSocket(); // io.close() also stops the HTTP server
    await closeQueues();
    await Promise.allSettled([sql.end({ timeout: 5 }), redisClient.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
};

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandled rejection');
  process.exit(1);
});

start().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
