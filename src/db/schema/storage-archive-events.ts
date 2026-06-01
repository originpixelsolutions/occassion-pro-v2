import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';

export const ARCHIVE_TYPES = [
  'lifecycle',
  'manual',
  'tenant_request',
  'quota_pressure',
  'retention_policy',
  'offload',
] as const;
export type ArchiveType = (typeof ARCHIVE_TYPES)[number];

export const ARCHIVE_STATUSES = [
  'in_progress',
  'completed',
  'restoring',
  'restored',
  'purged',
  'failed',
] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export const storageArchiveEvents = pgTable(
  'storage_archive_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    archiveType: text('archive_type').$type<ArchiveType>().notNull().default('lifecycle'),
    archiveDestination: text('archive_destination').notNull(),
    bytesArchived: bigint('bytes_archived', { mode: 'bigint' }).notNull(),
    fileCount: integer('file_count').notNull(),
    status: text('status').$type<ArchiveStatus>().notNull().default('completed'),
    archivedAt: timestamp('archived_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    restoreWindowEndsAt: timestamp('restore_window_ends_at', { withTimezone: true }).notNull(),
    restoreRequestedAt: timestamp('restore_requested_at', { withTimezone: true }),
    restoreRequestedBy: uuid('restore_requested_by').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    restoredAt: timestamp('restored_at', { withTimezone: true }),
    restoredBytes: bigint('restored_bytes', { mode: 'bigint' }),
    restoredFileCount: integer('restored_file_count'),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    costEstimateUsd: numeric('cost_estimate_usd', { precision: 10, scale: 4 }),
    jobId: text('job_id'),
    notes: text('notes'),
    metadata: jsonb('metadata'),
    initiatedBy: uuid('initiated_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tenantTimeIx: index('idx_archive_events_tenant_time').on(t.tenantId, t.archivedAt),
    typeEnum: check(
      'sae_type_enum',
      sql`${t.archiveType} IN ('lifecycle','manual','tenant_request','quota_pressure','retention_policy','offload')`,
    ),
    statusEnum: check(
      'sae_status_enum',
      sql`${t.status} IN ('in_progress','completed','restoring','restored','purged','failed')`,
    ),
    bytesPositive: check('sae_bytes_positive', sql`${t.bytesArchived} > 0`),
    filePositive: check('sae_file_positive', sql`${t.fileCount} > 0`),
    windowAfterArchive: check(
      'sae_window_after_archive',
      sql`${t.restoreWindowEndsAt} > ${t.archivedAt}`,
    ),
  }),
);
export type StorageArchiveEvent = typeof storageArchiveEvents.$inferSelect;
