import type { CookieOptions, RequestHandler } from 'express';
import { z } from 'zod';
import { isProd } from '@/config/env';
import { ACCESS_COOKIE } from '@/middleware/auth';
import { camelKeys } from '@/utils/camelKeys';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { parse } from '@/utils/parse';
import * as authService from '@/routes/auth/authService';

export const REFRESH_COOKIE = 'refreshToken';

const cookieBase: CookieOptions = { httpOnly: true, secure: isProd, sameSite: 'strict' };

const loginSchema = z.object({
  // Normalize first: z.email() runs its check before .trim() would.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(128),
});

export const login: RequestHandler = async (req, res, next) => {
  try {
    const body = parse(loginSchema, req.body);
    const { user, accessToken, refreshToken } = await authService.login(body);
    res
      .cookie(ACCESS_COOKIE, accessToken, { ...cookieBase, path: '/', maxAge: authService.ACCESS_TTL_MS })
      // Only sent to auth endpoints (refresh/logout), not every API call.
      .cookie(REFRESH_COOKIE, refreshToken, { ...cookieBase, path: '/api/auth', maxAge: authService.REFRESH_TTL_MS })
      .status(HTTP_STATUS.OK)
      .json({ data: camelKeys({ user }) });
  } catch (err) {
    next(err);
  }
};
