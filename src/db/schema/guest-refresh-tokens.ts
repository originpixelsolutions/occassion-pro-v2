import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { guests } from './guests.js';

export const GUEST_REFRESH_REVOKED_REASONS = [
  'rotated',
  'logout',
  'reuse_detected',
  'admin',
  'expired',
  'suspended_account',
] as const;
export type GuestRefreshRevokedReason = (typeof GUEST_REFRESH_REVOKED_REASONS)[number];

export const guestRefreshTokens = pgTable(
  'guest_refresh_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    replacedBy: uuid('replaced_by'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason').$type<GuestRefreshRevokedReason>(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tokenHashUq: uniqueIndex('idx_guest_refresh_tokens_hash').on(t.tokenHash),
    familyLive: index('idx_guest_refresh_tokens_family')
      .on(t.familyId)
      .where(sql`${t.revokedAt} IS NULL`),
    expiryWindow: check(
      'grt_expiry_window',
      sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '90 days'`,
    ),
    revCoupling: check(
      'grt_rev_coupling',
      sql`(${t.revokedAt} IS NULL) = (${t.revokedReason} IS NULL)`,
    ),
    replacedRequiresRevoked: check(
      'grt_replaced_requires_revoked',
      sql`${t.replacedBy} IS NULL OR ${t.revokedAt} IS NOT NULL`,
    ),
  }),
);
export type GuestRefreshToken = typeof guestRefreshTokens.$inferSelect;
