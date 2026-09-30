import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '@/config/logger';
import { AppError } from '@/utils/appError';

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) },
    });
    return;
  }

  // body-parser errors (malformed JSON, payload too large) carry a 4xx status
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    return;
  }

  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
