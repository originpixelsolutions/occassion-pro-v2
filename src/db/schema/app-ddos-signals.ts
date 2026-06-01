import { sql } from 'drizzle-orm';
import { bigserial, boolean, check, index, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const DDOS_SIGNAL_TYPES = [
  'rate_burst','pattern_attack','enumeration_attack',
  'slow_loris','credential_stuffing','api_abuse',
] as const;
export type DdosSignalType = (typeof DDOS_SIGNAL_TYPES)[number];

export const HTTP_METHODS = ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const appDdosSignals = pgTable(
  'app_ddos_signals',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    signalType: text('signal_type').$type<DdosSignalType>().notNull(),
    ipAddress: text('ip_address'), // SQL type inet
    ipCountry: varchar('ip_country', { length: 2 }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    endpoint: text('endpoint'),
    httpMethod: text('http_method').$type<HttpMethod>(),
    count: integer('count').notNull(),
    windowSeconds: integer('window_seconds'),
    userAgent: text('user_agent'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().default(sql`now()`),
    blocked: boolean('blocked').notNull().default(false),
    blockDurationSeconds: integer('block_duration_seconds'),
    notes: text('notes'),
  },
  (t) => ({
    signalEnum: check(
      'ads_signal_type',
      sql`${t.signalType} IN ('rate_burst','pattern_attack','enumeration_attack','slow_loris','credential_stuffing','api_abuse')`,
    ),
    methodEnum: check(
      'ads_http_method',
      sql`${t.httpMethod} IS NULL OR ${t.httpMethod} IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS')`,
    ),
    countPos: check('ads_count_pos', sql`${t.count} >= 1`),
    blockedPair: check(
      'ads_blocked_pair',
      sql`(${t.blocked} = FALSE AND ${t.blockDurationSeconds} IS NULL) OR (${t.blocked} = TRUE AND ${t.blockDurationSeconds} IS NOT NULL)`,
    ),
    ipIdx: index('idx_ddos_signals_ip').on(t.ipAddress, t.detectedAt),
  }),
);
export type AppDdosSignal = typeof appDdosSignals.$inferSelect;
