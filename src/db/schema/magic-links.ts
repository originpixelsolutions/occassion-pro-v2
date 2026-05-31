import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';

export const MAGIC_LINK_USER_TYPES = [
  'tenant_member', 'super_admin', 'client', 'vendor', 'speaker',
] as const;
export type MagicLinkUserType = (typeof MAGIC_LINK_USER_TYPES)[number];

export const magicLinks = pgTable(
  'magic_links',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    userType: text('user_type').$type<MagicLinkUserType>().notNull(),
    email: citext('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    ipAddress: text('ip_address'), // SQL type inet
    userAgent: text('user_agent'),
    deviceFingerprint: text('device_fingerprint'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedIp: text('consumed_ip'), // SQL type inet
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    tokenHashUq: uniqueIndex('magic_links_token_hash_key').on(t.tokenHash),
    userTypeEnum: check(
      'ml_user_type',
      sql`${t.userType} IN ('tenant_member','super_admin','client','vendor','speaker')`,
    ),
    tokenHashLen: check('ml_token_hash_len', sql`length(${t.tokenHash}) = 64`),
    consumedPair: check(
      'ml_consumed_pair',
      sql`(${t.consumedAt} IS NULL) = (${t.consumedIp} IS NULL)`,
    ),
    expiresUnderHour: check(
      'ml_expires_under_hour',
      sql`${t.expiresAt} <= ${t.createdAt} + INTERVAL '1 hour'`,
    ),
    userLookupIdx: index('idx_magic_links_user').on(t.userId, t.userType, t.consumedAt),
  }),
);
export type MagicLink = typeof magicLinks.$inferSelect;
