import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { AppError } from '@/utils/appError';
import { HTTP_STATUS } from '@/utils/httpStatus';

export const ACCESS_COOKIE = 'accessToken';

// ponytail: hand-rolled single-cookie read; swap for cookie-parser if many cookies need parsing.
function readCookie(header: string | undefined, name: string): string | undefined {
  const match = header?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const token = readCookie(req.headers.cookie, ACCESS_COOKIE);
  if (!token) return next(new AppError(HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED', 'Authentication required'));

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad payload');
    req.userId = payload.sub;
    next();
  } catch {
    // Expired and tampered tokens get the same 401; the client then tries /api/auth/refresh-token.
    next(new AppError(HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
};
