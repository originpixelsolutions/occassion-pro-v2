import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

/**
 * tenant_api_keys — Phase 2, Unit 7 (spec 3.10).
 *
 * The full secret is shown to the user ONCE at creation. The DB only
 * stores key_prefix (for UI surface) and key_hash (sha256 of the full key).
 */
export const tenantApiKeys = pgTable(
  'tenant_api_keys',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: text('last_used_ip'), // SQL type inet
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`(now() + INTERVAL '365 days')`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    nameLen: check('api_keys_name_len', sql`length(trim(${t.name})) BETWEEN 1 AND 120`),
    prefixFmt: check(
      'api_keys_prefix_fmt',
      sql`${t.keyPrefix} ~ '^op_(live|test)_[A-Za-z0-9]{8}$'`,
    ),
    hashLen: check('api_keys_hash_len', sql`length(${t.keyHash}) = 64`),
    scopesNotEmpty: check('api_keys_scopes_ne', sql`cardinality(${t.scopes}) >= 1`),
    expiresFuture: check('api_keys_expires_future', sql`${t.expiresAt} > ${t.createdAt}`),
    keyHashUq: uniqueIndex('idx_api_key_hash').on(t.keyHash),
    tenantIdx: index('idx_api_key_tenant').on(t.tenantId),
  }),
);
export type TenantApiKey = typeof tenantApiKeys.$inferSelect;
