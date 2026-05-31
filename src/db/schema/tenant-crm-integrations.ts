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
  dataType() { return 'bytea'; },
});

export const CRM_PROVIDERS = ['salesforce','hubspot','zoho_crm','pipedrive','freshsales'] as const;
export type CrmProvider = (typeof CRM_PROVIDERS)[number];

export const CRM_SYNC_DIRECTIONS = ['to_crm','from_crm','two_way'] as const;
export type CrmSyncDirection = (typeof CRM_SYNC_DIRECTIONS)[number];

export const CRM_STATUSES = ['active','expired','disconnected','error'] as const;
export type CrmIntegrationStatus = (typeof CRM_STATUSES)[number];

export const tenantCrmIntegrations = pgTable(
  'tenant_crm_integrations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<CrmProvider>().notNull(),
    accessTokenEncrypted: bytea('access_token_encrypted').notNull(),
    refreshTokenEncrypted: bytea('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    workspaceId: text('workspace_id'),
    syncDirection: text('sync_direction').$type<CrmSyncDirection>().notNull().default('two_way'),
    fieldMapping: jsonb('field_mapping').$type<Record<string, string>>().notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    status: text('status').$type<CrmIntegrationStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    providerEnum: check(
      'tci_provider',
      sql`${t.provider} IN ('salesforce','hubspot','zoho_crm','pipedrive','freshsales')`,
    ),
    statusEnum: check(
      'tci_status',
      sql`${t.status} IN ('active','expired','disconnected','error')`,
    ),
    syncDirEnum: check(
      'tci_sync_direction',
      sql`${t.syncDirection} IN ('to_crm','from_crm','two_way')`,
    ),
    tokenNonEmpty: check('tci_token_non_empty', sql`octet_length(${t.accessTokenEncrypted}) > 0`),
    mappingObject: check('tci_mapping_object', sql`jsonb_typeof(${t.fieldMapping}) = 'object'`),
    expiredConsistency: check(
      'tci_expired_consistency',
      sql`${t.status} <> 'expired' OR ${t.tokenExpiresAt} IS NOT NULL`,
    ),
    providerIdx: index('idx_tci_provider').on(t.provider),
  }),
);
export type TenantCrmIntegration = typeof tenantCrmIntegrations.$inferSelect;
