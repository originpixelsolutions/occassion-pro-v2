import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * tenant_external_storage — Phase 2, Unit 9 (spec 8).
 *
 * Tokens are encrypted at the app layer (libsodium sealed box); DB only
 * stores ciphertext bytes. is_default is constrained to a single ACTIVE
 * row per tenant via a partial unique index in the migration.
 */
export const STORAGE_PROVIDERS = [
  'google_drive',
  'dropbox',
  'onedrive',
  's3',
  'r2',
  'b2',
  'wasabi',
] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const STORAGE_STATUSES = ['active', 'expired', 'disconnected'] as const;
export type StorageStatus = (typeof STORAGE_STATUSES)[number];

export const tenantExternalStorage = pgTable(
  'tenant_external_storage',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<StorageProvider>().notNull(),
    accessTokenEncrypted: bytea('access_token_encrypted').notNull(),
    refreshTokenEncrypted: bytea('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    rootFolderId: text('root_folder_id'),
    displayName: text('display_name'),
    isDefault: boolean('is_default').notNull().default(false),
    connectedBy: uuid('connected_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    status: text('status').$type<StorageStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    providerEnum: check(
      'tes_provider',
      sql`${t.provider} IN ('google_drive','dropbox','onedrive','s3','r2','b2','wasabi')`,
    ),
    statusEnum: check(
      'tes_status',
      sql`${t.status} IN ('active','expired','disconnected')`,
    ),
    tokenNonEmpty: check(
      'tes_token_non_empty',
      sql`octet_length(${t.accessTokenEncrypted}) > 0`,
    ),
    expiredConsistency: check(
      'tes_expired_consistency',
      sql`${t.status} <> 'expired' OR ${t.tokenExpiresAt} IS NOT NULL`,
    ),
    providerIdx: index('idx_tenant_ext_storage_provider').on(t.tenantId, t.provider),
  }),
);
export type TenantExternalStorage = typeof tenantExternalStorage.$inferSelect;
