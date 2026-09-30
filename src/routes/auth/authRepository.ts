import { eq } from 'drizzle-orm';
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
