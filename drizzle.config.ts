import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle configuration.
 *
 * The hand-written SQL migrations in `supabase/migrations/` are the source of
 * truth for the schema. Drizzle is used for type-safe queries, not for
 * generating migrations. `drizzle-kit push` is for dev sandboxes only — never
 * for staging / production.
 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
  },
  strict: true,
  verbose: true,
});
