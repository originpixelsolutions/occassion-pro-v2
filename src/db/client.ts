import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * Production / staging DB client. Uses postgres-js with transaction pooling.
 * In Cloudflare Workers this is instantiated per request; in Node it's a
 * long-lived singleton.
 */
export function createDbClient(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 1, // Workers / serverless: one conn per invocation
    prepare: false, // pgBouncer transaction pooling forbids server-side prepare
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema, casing: 'snake_case' });
}

export type Db = ReturnType<typeof createDbClient>;
export { schema };
