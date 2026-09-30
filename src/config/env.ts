import { z } from 'zod';

// Local dev: load .env if present. In prod the platform injects env vars.
try {
  process.loadEnvFile();
} catch {
  // no .env file — fine
}

const secret = z.string().min(32);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  FRONTEND_URL: z.url(),
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // logger depends on env, so fail loudly on stderr and exit before boot
  process.stderr.write(`Invalid environment:\n${z.prettifyError(parsed.error)}\n`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
