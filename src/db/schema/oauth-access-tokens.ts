import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantOauthApps } from './tenant-oauth-apps.js';
import { oauthAuthorizationCodes } from './oauth-authorization-codes.js';
import { tenants } from './tenants.js';

export const OAT_USER_TYPES = [
  'tenant_member','super_admin','client','vendor','speaker',
] as const;
export type OatUserType = (typeof OAT_USER_TYPES)[number];

export const OAT_REVOKE_REASONS = [
  'user_revoke','admin_revoke','rotation','expired','suspicious','app_revoke',
] as const;
export type OatRevokeReason = (typeof OAT_REVOKE_REASONS)[number];

export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    oauthAppId: uuid('oauth_app_id')
      .notNull()
      .references(() => tenantOauthApps.id, { onDelete: 'cascade' }),
    authorizationCodeId: uuid('authorization_code_id').references(
      () => oauthAuthorizationCodes.id,
      { onDelete: 'set null' },
    ),
    accessTokenHash: text('access_token_hash').notNull(),
    refreshTokenHash: text('refresh_token_hash'),
    userId: uuid('user_id').notNull(),
    userType: text('user_type').$type<OatUserType>().notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull(),
    tokenType: text('token_type').notNull().default('Bearer'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: text('last_used_ip'), // SQL type inet
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason').$type<OatRevokeReason>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    userTypeEnum: check(
      'oat_user_type',
      sql`${t.userType} IN ('tenant_member','super_admin','client','vendor','speaker')`,
    ),
    accessHashLen: check('oat_access_hash_len', sql`length(${t.accessTokenHash}) = 64`),
    scopesNonEmpty: check('oat_scopes_non_empty', sql`cardinality(${t.scopes}) >= 1`),
    accessUnder24h: check(
      'oat_access_under_24h',
      sql`${t.expiresAt} <= ${t.createdAt} + INTERVAL '24 hours'`,
    ),
    refreshAfterAccess: check(
      'oat_refresh_after_access',
      sql`${t.refreshExpiresAt} IS NULL OR ${t.refreshExpiresAt} > ${t.expiresAt}`,
    ),
    refreshPair: check(
      'oat_refresh_pair',
      sql`(${t.refreshTokenHash} IS NULL) = (${t.refreshExpiresAt} IS NULL)`,
    ),
    revokedPair: check(
      'oat_revoked_pair',
      sql`(${t.revokedAt} IS NULL) = (${t.revokeReason} IS NULL)`,
    ),
    appIdx: index('idx_oat_app').on(t.oauthAppId, t.expiresAt),
  }),
);
export type OauthAccessToken = typeof oauthAccessTokens.$inferSelect;
