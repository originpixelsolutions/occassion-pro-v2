import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { superAdmins } from './super-admins.js';

export const TENANT_STATUSES = ['active', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull().unique(),
    companyName: text('company_name').notNull(),
    legalName: text('legal_name'),
    logoUrl: text('logo_url'),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    billingCurrency: varchar('billing_currency', { length: 3 }).notNull(),
    businessCountry: text('business_country'),
    gstin: text('gstin'),
    vatNumber: text('vat_number'),
    taxExemptCertificate: text('tax_exempt_certificate'),
    previousCompanyNames: jsonb('previous_company_names')
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status').$type<TenantStatus>().notNull().default('active'),
    brandPrimaryOverride: text('brand_primary_override'),
    brandSecondaryOverride: text('brand_secondary_override'),
    brandGradientStartOverride: text('brand_gradient_start_override'),
    brandGradientEndOverride: text('brand_gradient_end_override'),
    guestPortalThemeOverride: jsonb('guest_portal_theme_override'),
    publicWebsiteThemeOverride: jsonb('public_website_theme_override'),
    invitationDefaultThemeOverride: jsonb('invitation_default_theme_override'),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    suspendedBy: uuid('suspended_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    region: text('region').notNull().default('ap-south-1'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    slugFormat: check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'`),
    statusEnum: check('tenants_status', sql`${t.status} IN ('active','suspended','cancelled')`),
    statusIdx: index('idx_tenants_status')
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
    createdAtIdx: index('idx_tenants_created_at').on(t.createdAt),
  }),
);
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
