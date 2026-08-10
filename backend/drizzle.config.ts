import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/infrastructure/src/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://satori:satori@localhost:5432/satori' },
  strict: true,
  verbose: true,
});
