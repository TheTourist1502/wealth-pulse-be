import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { env } from '@/config/env';
import { checkDatabase } from '@/config/database';
import { redisClient } from '@/config/redis';
import { errorHandler, notFound } from '@/middleware/errorHandler';
import { requestLogger } from '@/middleware/requestLogger';
import routes from '@/routes';
import { asyncHandler } from '@/utils/asyncHandler';
import { HTTP_STATUS } from '@/utils/httpStatus';

// Exported without listen() so Supertest can drive it.
export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(requestLogger);
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '100kb' }));

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    const [db, redis] = await Promise.allSettled([checkDatabase(), redisClient.ping()]);
    const ok = db.status === 'fulfilled' && redis.status === 'fulfilled';
    res.status(ok ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE).json({
      data: { status: ok ? 'ok' : 'degraded', db: db.status === 'fulfilled', redis: redis.status === 'fulfilled' },
    });
  }),
);

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);
