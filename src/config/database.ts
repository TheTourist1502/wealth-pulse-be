import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '@/config/env';
import * as schema from '@/db/schema';

export const sql = postgres(env.DATABASE_URL, { max: 20 });

export const db = drizzle(sql, { schema });

export const checkDatabase = async (): Promise<void> => {
  await sql`select 1`;
};

// `db` or the `tx` handed to db.transaction(); repository writes accept either.
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
