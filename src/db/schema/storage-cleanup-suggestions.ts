import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

const uuidArray = customType<{ data: string[] | null; driverData: string }>({
  dataType() {
    return 'uuid[]';
  },
});

export const CLEANUP_SUGGESTION_TYPES = [
  'lite_archive_old',
  'delete_duplicates',
  'delete_old_exports',
  'delete_old_pdfs',
  'offload_old',
  'archive_old_events',
  'compress_videos',
  'dedupe_uploads',
  'retention_purge',
] as const;
export type CleanupSuggestionType = (typeof CLEANUP_SUGGESTION_TYPES)[number];

export const CLEANUP_STATUSES = ['open', 'dismissed', 'applied', 'superseded', 'expired'] as const;
export type CleanupStatus = (typeof CLEANUP_STATUSES)[number];

export const CLEANUP_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type CleanupPriority = (typeof CLEANUP_PRIORITIES)[number];

export const storageCleanupSuggestions = pgTable(
  'storage_cleanup_suggestions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    suggestionType: text('suggestion_type').$type<CleanupSuggestionType>().notNull(),
    priority: text('priority').$type<CleanupPriority>().notNull().default('normal'),
    targetEventIds: uuidArray('target_event_ids'),
    targetObjectCount: integer('target_object_count'),
    bytesToFree: bigint('bytes_to_free', { mode: 'bigint' }),
    estimatedSavingsUsd: numeric('estimated_savings_usd', { precision: 10, scale: 4 }),
    description: text('description').notNull(),
    rationale: text('rationale'),
    status: text('status').$type<CleanupStatus>().notNull().default('open'),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: uuid('dismissed_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    dismissedReason: text('dismissed_reason'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    appliedBy: uuid('applied_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    appliedBytesFreed: bigint('applied_bytes_freed', { mode: 'bigint' }),
    supersededBy: uuid('superseded_by').references(
      (): AnyPgColumn => storageCleanupSuggestions.id,
      { onDelete: 'set null' },
    ),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tenantOpenIx: index('idx_cleanup_tenant_open')
      .on(t.tenantId, t.generatedAt)
      .where(sql`${t.status} = 'open'`),
    typeEnum: check(
      'scs_type_enum',
      sql`${t.suggestionType} IN ('lite_archive_old','delete_duplicates','delete_old_exports','delete_old_pdfs','offload_old','archive_old_events','compress_videos','dedupe_uploads','retention_purge')`,
    ),
    statusEnum: check(
      'scs_status_enum',
      sql`${t.status} IN ('open','dismissed','applied','superseded','expired')`,
    ),
    priorityEnum: check(
      'scs_priority_enum',
      sql`${t.priority} IN ('low','normal','high','critical')`,
    ),
    noSelfSupersede: check('scs_no_self_supersede', sql`${t.id} <> ${t.supersededBy}`),
  }),
);
export type StorageCleanupSuggestion = typeof storageCleanupSuggestions.$inferSelect;
