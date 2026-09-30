import { defineConfig } from 'drizzle-kit';

process.loadEnvFile();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
