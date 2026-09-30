import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import { AppError, toAppError } from '@/utils/appError';
import { HTTP_STATUS } from '@/utils/httpStatus';
import * as authRepository from '@/routes/auth/authRepository';

export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Compared against when the email is unknown so both failure paths take the same bcrypt time.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const login = async ({ email, password }: { email: string; password: string }) => {
  try {
    const user = await authRepository.findUserByEmail(email);
    const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !valid) throw new AppError(HTTP_STATUS.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid email or password');

    const accessToken = jwt.sign({}, env.JWT_ACCESS_SECRET, { subject: user.id, expiresIn: ACCESS_TTL_MS / 1000 });
    // jti makes each refresh token unique even when issued in the same second.
    const refreshToken = jwt.sign({}, env.JWT_REFRESH_SECRET, {
      subject: user.id,
      expiresIn: REFRESH_TTL_MS / 1000,
      jwtid: randomUUID(),
    });

    await authRepository.insertRefreshToken({
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });

    const { id, firstName, lastName, role } = user;
    return { user: { id, email: user.email, firstName, lastName, role }, accessToken, refreshToken };
  } catch (err) {
    throw toAppError(err);
  }
};
