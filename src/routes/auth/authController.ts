import type { CookieOptions, RequestHandler } from 'express';
import { z } from 'zod';
import { isProd } from '@/config/env';
import { ACCESS_COOKIE, readCookie } from '@/middleware/auth';
import { camelKeys } from '@/utils/camelKeys';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { parse } from '@/utils/parse';
import * as authService from '@/routes/auth/authService';

export const REFRESH_COOKIE = 'refreshToken';
const REFRESH_PATH = '/api/auth';

const cookieBase: CookieOptions = { httpOnly: true, secure: isProd, sameSite: 'strict' };

const loginSchema = z.object({
  // Normalize first: z.email() runs its check before .trim() would.
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().default(false),
});

export const login: RequestHandler = async (req, res, next) => {
  try {
    const body = parse(loginSchema, req.body);
    const { user, accessToken, refreshToken } = await authService.login(body);
    res
      .cookie(ACCESS_COOKIE, accessToken, { ...cookieBase, path: '/', maxAge: authService.ACCESS_TTL_MS })
      // Only sent to auth endpoints (refresh/logout), not every API call.
      // Without "remember me" it's a browser-session cookie (no maxAge); the token itself expires in 1 day.
      .cookie(REFRESH_COOKIE, refreshToken, {
        ...cookieBase,
        path: REFRESH_PATH,
        ...(body.rememberMe && { maxAge: authService.refreshTtlMs(true) }),
      })
      .status(HTTP_STATUS.OK)
      .json({ data: camelKeys({ user }) });
  } catch (err) {
    next(err);
  }
};

export const me: RequestHandler = async (req, res, next) => {
  try {
    const user = await authService.me(req.userId);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys({ user }) });
  } catch (err) {
    next(err);
  }
};

export const refresh: RequestHandler = async (req, res, next) => {
  try {
    const { accessToken } = await authService.refresh(readCookie(req.headers.cookie, REFRESH_COOKIE));
    res
      .cookie(ACCESS_COOKIE, accessToken, { ...cookieBase, path: '/', maxAge: authService.ACCESS_TTL_MS })
      .status(HTTP_STATUS.NO_CONTENT)
      .end();
  } catch (err) {
    next(err);
  }
};

export const logout: RequestHandler = async (req, res, next) => {
  try {
    await authService.logout(readCookie(req.headers.cookie, REFRESH_COOKIE));
    res
      .clearCookie(ACCESS_COOKIE, { ...cookieBase, path: '/' })
      .clearCookie(REFRESH_COOKIE, { ...cookieBase, path: REFRESH_PATH })
      .status(HTTP_STATUS.NO_CONTENT)
      .end();
  } catch (err) {
    next(err);
  }
};
