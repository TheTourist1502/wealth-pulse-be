import pino from 'pino';
import { env, isProd } from '@/config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Colored, human-readable output in dev; raw JSON in prod for log aggregators.
  transport: isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.password',
    '*.token',
    '*.refreshToken',
  ],
});
