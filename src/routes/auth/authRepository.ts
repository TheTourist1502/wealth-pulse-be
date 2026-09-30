import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/config/database';
import { refreshTokens, users } from '@/db/schema';
import { toDbError } from '@/utils/appError';

export const findUserByEmail = async (email: string) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  } catch (err) {
    throw toDbError(err);
  }
};

export const insertRefreshToken = async (values: typeof refreshTokens.$inferInsert) => {
  try {
    await db.insert(refreshTokens).values(values);
  } catch (err) {
    throw toDbError(err);
  }
};

export const findUserById = async (id: string) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  } catch (err) {
    throw toDbError(err);
  }
};

export const findRefreshToken = async (tokenHash: string) => {
  try {
    const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const revokeRefreshToken = async (tokenHash: string) => {
  try {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  } catch (err) {
    throw toDbError(err);
  }
};
