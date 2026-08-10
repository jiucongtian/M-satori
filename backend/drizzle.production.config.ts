import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './dist/packages/infrastructure/src/database/schema.js',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://satori:satori@postgres:5432/satori',
  },
  strict: true,
  verbose: true,
});
