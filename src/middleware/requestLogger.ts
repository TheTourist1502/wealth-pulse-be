import type { RequestHandler } from 'express';
import { logger } from '@/config/logger';
import { HTTP_STATUS } from '@/utils/httpStatus';

// Logs method, path, status and duration once the response is sent.
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const { statusCode } = res;
    const level = statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR ? 'error' : statusCode >= HTTP_STATUS.BAD_REQUEST ? 'warn' : 'info';
    // Path only: query strings can carry tokens (e.g. password reset).
    const path = req.originalUrl.split('?')[0];
    const ms = Math.round(performance.now() - start);
    logger[level]({ method: req.method, path, status: statusCode, ms }, `${req.method} ${path} ${statusCode} ${ms}ms`);
  });
  next();
};
