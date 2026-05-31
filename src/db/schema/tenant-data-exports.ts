import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

export const EXPORT_TYPES = ['full', 'pre_downgrade', 'pre_cancellation', 'dsar'] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export const EXPORT_STATUSES = ['queued', 'running', 'completed', 'failed', 'expired'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const tenantDataExports = pgTable(
  'tenant_data_exports',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    exportType: text('export_type').$type<ExportType>().notNull(),
    status: text('status').$type<ExportStatus>().notNull().default('queued'),
    zipUrl: text('zip_url'),
    zipSizeBytes: bigint('zip_size_bytes', { mode: 'number' }),
    zipExpiresAt: timestamp('zip_expires_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    typeEnum: check(
      'tde_type',
      sql`${t.exportType} IN ('full','pre_downgrade','pre_cancellation','dsar')`,
    ),
    statusEnum: check(
      'tde_status',
      sql`${t.status} IN ('queued','running','completed','failed','expired')`,
    ),
    sizeBounds: check('tde_size', sql`${t.zipSizeBytes} IS NULL OR ${t.zipSizeBytes} >= 0`),
    urlHttps: check(
      'tde_url_https',
      sql`${t.zipUrl} IS NULL OR ${t.zipUrl} ~ '^https://'`,
    ),
    tenantTimeIdx: index('idx_data_exports_tenant').on(t.tenantId, t.createdAt),
  }),
);
export type TenantDataExport = typeof tenantDataExports.$inferSelect;
