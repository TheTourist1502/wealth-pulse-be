import type { ErrorRequestHandler, RequestHandler } from 'express';
import { logger } from '@/config/logger';
import { AppError } from '@/utils/appError';
import { HTTP_STATUS } from '@/utils/httpStatus';

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof AppError) {
    // Wrapped 500s carry the real failure on `cause`; log it, never send it.
    if (err.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) logger.error({ err }, 'server error');
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) },
    });
    return;
  }

  // body-parser errors (malformed JSON, payload too large) carry a 4xx status
  const status = (err as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= HTTP_STATUS.BAD_REQUEST && status < HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    return;
  }

  logger.error({ err }, 'unhandled error');
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
