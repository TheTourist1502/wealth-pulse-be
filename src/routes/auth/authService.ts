import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { AppError, toAppError } from '@/utils/appError';
import { HTTP_STATUS } from '@/utils/httpStatus';
import * as authRepository from '@/routes/auth/authRepository';

export const ACCESS_TTL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// "Remember me" keeps the session 30 days; otherwise 1 day in a browser-session cookie.
export const refreshTtlMs = (rememberMe: boolean) => (rememberMe ? 30 : 1) * DAY_MS;

// Compared against when the email is unknown so both failure paths take the same bcrypt time.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const toPublicUser = (user: { id: string; email: string; firstName: string; lastName: string; role: string }) => {
  const { id, email, firstName, lastName, role } = user;
  return { id, email, firstName, lastName, role };
};

const signAccessToken = (userId: string) =>
  jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: ACCESS_TTL_MS / 1000 });

const unauthorized = () => new AppError(HTTP_STATUS.UNAUTHORIZED, 'UNAUTHORIZED', 'Invalid or expired session');

export const login = async ({ email, password, rememberMe }: { email: string; password: string; rememberMe: boolean }) => {
  try {
    const user = await authRepository.findUserByEmail(email);
    const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !valid) throw new AppError(HTTP_STATUS.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password');

    const accessToken = signAccessToken(user.id);
    const ttlMs = refreshTtlMs(rememberMe);
    // jti makes each refresh token unique even when issued in the same second.
    const refreshToken = jwt.sign({}, env.JWT_REFRESH_SECRET, {
      subject: user.id,
      expiresIn: ttlMs / 1000,
      jwtid: randomUUID(),
    });

    await authRepository.insertRefreshToken({
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + ttlMs),
    });

    return { user: toPublicUser(user), accessToken, refreshToken };
  } catch (err) {
    throw toAppError(err);
  }
};

export const me = async (userId: string) => {
  try {
    const user = await authRepository.findUserById(userId);
    if (!user) throw unauthorized();
    return toPublicUser(user);
  } catch (err) {
    throw toAppError(err);
  }
};

// ponytail: reissues the access token only; rotate the refresh token too if reuse detection is needed.
export const refresh = async (refreshToken: string | undefined) => {
  try {
    if (!refreshToken) throw unauthorized();
    let userId: string;
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('bad payload');
      userId = payload.sub;
    } catch {
      throw unauthorized();
    }
    const row = await authRepository.findRefreshToken(sha256(refreshToken));
    if (!row || row.revokedAt || row.expiresAt < new Date() || row.userId !== userId) throw unauthorized();
    return { accessToken: signAccessToken(userId) };
  } catch (err) {
    throw toAppError(err);
  }
};

export const logout = async (refreshToken: string | undefined) => {
  try {
    if (refreshToken) await authRepository.revokeRefreshToken(sha256(refreshToken));
  } catch (err) {
    throw toAppError(err);
  }
};
