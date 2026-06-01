import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantOauthApps } from './tenant-oauth-apps.js';
import { tenants } from './tenants.js';

export const OAC_USER_TYPES = [
  'tenant_member',
  'super_admin',
  'client',
  'vendor',
  'speaker',
] as const;
export type OacUserType = (typeof OAC_USER_TYPES)[number];

export const PKCE_METHODS = ['S256', 'plain'] as const;
export type PkceMethod = (typeof PKCE_METHODS)[number];

export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    oauthAppId: uuid('oauth_app_id')
      .notNull()
      .references(() => tenantOauthApps.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    userId: uuid('user_id').notNull(),
    userType: text('user_type').$type<OacUserType>().notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    scopes: text('scopes').array().notNull(),
    codeChallenge: text('code_challenge'),
    codeChallengeMethod: text('code_challenge_method').$type<PkceMethod>(),
    ipAddress: text('ip_address'), // SQL type inet
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedIp: text('consumed_ip'), // SQL type inet
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    codeHashUq: uniqueIndex('oauth_authorization_codes_code_hash_key').on(t.codeHash),
    codeHashLen: check('oac_code_hash_len', sql`length(${t.codeHash}) = 64`),
    userTypeEnum: check(
      'oac_user_type',
      sql`${t.userType} IN ('tenant_member','super_admin','client','vendor','speaker')`,
    ),
    scopesNonEmpty: check('oac_scopes_non_empty', sql`cardinality(${t.scopes}) >= 1`),
    expiresUnder10Min: check(
      'oac_expires_under_10min',
      sql`${t.expiresAt} <= ${t.createdAt} + INTERVAL '10 minutes'`,
    ),
    consumedPair: check(
      'oac_consumed_pair',
      sql`(${t.consumedAt} IS NULL) = (${t.consumedIp} IS NULL)`,
    ),
    pkcePair: check(
      'oac_pkce_pair',
      sql`(${t.codeChallenge} IS NULL) = (${t.codeChallengeMethod} IS NULL)`,
    ),
    appIdx: index('idx_oac_app').on(t.oauthAppId, t.expiresAt),
  }),
);
export type OauthAuthorizationCode = typeof oauthAuthorizationCodes.$inferSelect;
