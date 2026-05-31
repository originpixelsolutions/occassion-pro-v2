import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const SESSION_USER_TYPES = [
  'tenant_member',
  'super_admin',
  'client',
  'vendor',
  'guest',
  'speaker',
] as const;
export type SessionUserType = (typeof SESSION_USER_TYPES)[number];

export const SESSION_PORTALS = [
  'admin',
  'tenant',
  'client',
  'vendor',
  'guest',
  'speaker',
  'super_admin',
] as const;
export type SessionPortal = (typeof SESSION_PORTALS)[number];

export const REVOKE_REASONS = [
  'user_logout',
  'admin_revoke',
  'concurrent_limit',
  'suspicious',
  'password_change',
  'refresh_rotation',
  'mfa_revoke',
] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull(),
    userType: text('user_type').$type<SessionUserType>().notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    portal: text('portal').$type<SessionPortal>().notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    deviceFingerprint: text('device_fingerprint'),
    deviceName: text('device_name'),
    deviceType: text('device_type'),
    os: text('os'),
    browser: text('browser'),
    ipAddress: text('ip_address'), // SQL type inet
    ipCountry: varchar('ip_country', { length: 2 }),
    userAgent: text('user_agent'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason').$type<RevokeReason>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    userTypeEnum: check(
      'as_user_type',
      sql`${t.userType} IN ('tenant_member','super_admin','client','vendor','guest','speaker')`,
    ),
    portalEnum: check(
      'as_portal',
      sql`${t.portal} IN ('admin','tenant','client','vendor','guest','speaker','super_admin')`,
    ),
    refreshHashLen: check('as_refresh_hash_len', sql`length(${t.refreshTokenHash}) = 64`),
    revokedPair: check(
      'as_revoked_pair',
      sql`(${t.revokedAt} IS NULL) = (${t.revokeReason} IS NULL)`,
    ),
    tenantRequiredUnlessSuper: check(
      'as_tenant_required_unless_super',
      sql`${t.userType} = 'super_admin' OR ${t.tenantId} IS NOT NULL`,
    ),
    expiresFuture: check('as_expires_future', sql`${t.expiresAt} > ${t.createdAt}`),
    userLookupIdx: index('idx_auth_sessions_user').on(t.userId, t.userType, t.revokedAt),
  }),
);
export type AuthSession = typeof authSessions.$inferSelect;
