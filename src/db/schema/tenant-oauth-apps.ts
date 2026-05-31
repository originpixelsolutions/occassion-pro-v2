import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

export const OAUTH_APP_STATUSES = ['active', 'suspended', 'revoked'] as const;
export type OauthAppStatus = (typeof OAUTH_APP_STATUSES)[number];

export const tenantOauthApps = pgTable(
  'tenant_oauth_apps',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    clientSecretHash: text('client_secret_hash').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    redirectUris: text('redirect_uris').array().notNull(),
    scopes: text('scopes').array().notNull(),
    grantTypes: text('grant_types').array().notNull(),
    homepageUrl: text('homepage_url'),
    logoUrl: text('logo_url'),
    isPublicListed: boolean('is_public_listed').notNull().default(false),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    status: text('status').$type<OauthAppStatus>().notNull().default('active'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    clientIdUq: uniqueIndex('tenant_oauth_apps_client_id_key').on(t.clientId),
    clientIdFmt: check(
      'toa_client_id_fmt',
      sql`${t.clientId} ~ '^op_app_[A-Za-z0-9]{16}$'`,
    ),
    secretHashLen: check('toa_secret_hash_len', sql`length(${t.clientSecretHash}) = 64`),
    redirectsNonEmpty: check('toa_redirects_non_empty', sql`cardinality(${t.redirectUris}) >= 1`),
    scopesNonEmpty: check('toa_scopes_non_empty', sql`cardinality(${t.scopes}) >= 1`),
    grantsNonEmpty: check('toa_grants_non_empty', sql`cardinality(${t.grantTypes}) >= 1`),
    statusEnum: check('toa_status', sql`${t.status} IN ('active','suspended','revoked')`),
    tenantActiveIdx: index('idx_toa_tenant_active').on(t.tenantId),
  }),
);
export type TenantOauthApp = typeof tenantOauthApps.$inferSelect;
