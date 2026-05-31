import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const ACCOUNTING_PROVIDERS = ['quickbooks', 'tally', 'zoho_books', 'xero', 'wave'] as const;
export type AccountingProvider = (typeof ACCOUNTING_PROVIDERS)[number];

export const ACCOUNTING_SYNC_DIRECTIONS = ['to_accounting', 'from_accounting', 'two_way'] as const;
export type AccountingSyncDirection = (typeof ACCOUNTING_SYNC_DIRECTIONS)[number];

export const ACCOUNTING_STATUSES = ['active', 'expired', 'disconnected', 'error'] as const;
export type AccountingIntegrationStatus = (typeof ACCOUNTING_STATUSES)[number];

export const tenantAccountingIntegrations = pgTable(
  'tenant_accounting_integrations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<AccountingProvider>().notNull(),
    accessTokenEncrypted: bytea('access_token_encrypted').notNull(),
    refreshTokenEncrypted: bytea('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    realmId: text('realm_id'),
    defaultRevenueAccount: text('default_revenue_account'),
    defaultTaxAccount: text('default_tax_account'),
    syncDirection: text('sync_direction')
      .$type<AccountingSyncDirection>()
      .notNull()
      .default('to_accounting'),
    fieldMapping: jsonb('field_mapping').$type<Record<string, string>>().notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    status: text('status').$type<AccountingIntegrationStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    providerEnum: check(
      'tai_provider',
      sql`${t.provider} IN ('quickbooks','tally','zoho_books','xero','wave')`,
    ),
    statusEnum: check(
      'tai_status',
      sql`${t.status} IN ('active','expired','disconnected','error')`,
    ),
    syncDirEnum: check(
      'tai_sync_direction',
      sql`${t.syncDirection} IN ('to_accounting','from_accounting','two_way')`,
    ),
    tokenNonEmpty: check('tai_token_non_empty', sql`octet_length(${t.accessTokenEncrypted}) > 0`),
    mappingObject: check('tai_mapping_object', sql`jsonb_typeof(${t.fieldMapping}) = 'object'`),
    expiredConsistency: check(
      'tai_expired_consistency',
      sql`${t.status} <> 'expired' OR ${t.tokenExpiresAt} IS NOT NULL`,
    ),
    providerIdx: index('idx_tai_provider').on(t.provider),
  }),
);
export type TenantAccountingIntegration = typeof tenantAccountingIntegrations.$inferSelect;
