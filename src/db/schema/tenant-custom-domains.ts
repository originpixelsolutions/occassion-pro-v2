import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { superAdmins } from './super-admins.js';

/**
 * tenant_custom_domains — Phase 2, Unit 8 (spec 3.7).
 *
 * State machine:
 *   pending_dns -> dns_verified -> pending_approval -> active
 *   (or -> revoked at any point)
 */
export const CUSTOM_DOMAIN_PURPOSES = ['shortlinks', 'website', 'both'] as const;
export type CustomDomainPurpose = (typeof CUSTOM_DOMAIN_PURPOSES)[number];

export const CUSTOM_DOMAIN_STATUSES = [
  'pending_dns',
  'dns_verified',
  'pending_approval',
  'active',
  'revoked',
] as const;
export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];

export const tenantCustomDomains = pgTable(
  'tenant_custom_domains',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    purpose: text('purpose').$type<CustomDomainPurpose>().notNull(),
    cnameTarget: text('cname_target').notNull(),
    dnsVerifiedAt: timestamp('dns_verified_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sslProvisionedAt: timestamp('ssl_provisioned_at', { withTimezone: true }),
    status: text('status').$type<CustomDomainStatus>().notNull().default('pending_dns'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    domainUq: uniqueIndex('tenant_custom_domains_domain_key').on(t.domain),
    purposeEnum: check('tcd_purpose', sql`${t.purpose} IN ('shortlinks','website','both')`),
    statusEnum: check(
      'tcd_status',
      sql`${t.status} IN ('pending_dns','dns_verified','pending_approval','active','revoked')`,
    ),
    tenantIdx: index('idx_tcd_tenant').on(t.tenantId),
    statusIdx: index('idx_tcd_status').on(t.status),
  }),
);
export type TenantCustomDomain = typeof tenantCustomDomains.$inferSelect;
