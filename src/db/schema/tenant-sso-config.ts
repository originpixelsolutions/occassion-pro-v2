import { sql } from 'drizzle-orm';
import { boolean, check, customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

export const SSO_PROVIDERS = [
  'google_workspace','microsoft_365','okta','onelogin','azure_ad','custom_saml','custom_oidc',
] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];

export const TENANT_ROLES = ['owner','event_manager','team_lead','team_member'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const tenantSsoConfig = pgTable(
  'tenant_sso_config',
  {
    tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<SsoProvider>().notNull(),
    configEncrypted: bytea('config_encrypted').notNull(),
    domainRestriction: text('domain_restriction').array(),
    enforceSso: boolean('enforce_sso').notNull().default(false),
    autoProvision: boolean('auto_provision').notNull().default(true),
    defaultRole: text('default_role').$type<TenantRole>().notNull().default('team_member'),
    configuredBy: uuid('configured_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    configuredAt: timestamp('configured_at', { withTimezone: true }).notNull().default(sql`now()`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    providerEnum: check(
      'tsc_provider',
      sql`${t.provider} IN ('google_workspace','microsoft_365','okta','onelogin','azure_ad','custom_saml','custom_oidc')`,
    ),
    configNonEmpty: check('tsc_config_non_empty', sql`octet_length(${t.configEncrypted}) > 0`),
    domainNonEmpty: check(
      'tsc_domain_non_empty',
      sql`${t.domainRestriction} IS NULL OR cardinality(${t.domainRestriction}) >= 1`,
    ),
    defaultRoleEnum: check(
      'tsc_default_role',
      sql`${t.defaultRole} IN ('owner','event_manager','team_lead','team_member')`,
    ),
    providerIdx: index('idx_tsc_provider').on(t.provider),
  }),
);
export type TenantSsoConfig = typeof tenantSsoConfig.$inferSelect;
