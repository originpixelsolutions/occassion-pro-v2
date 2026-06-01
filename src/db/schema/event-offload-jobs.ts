import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantExternalStorage } from './tenant-external-storage.js';
import { tenantMembers } from './tenant-members.js';

export const OFFLOAD_JOB_STATUSES = [
  'queued', 'running', 'completed', 'failed', 'cancelled',
] as const;
export type OffloadJobStatus = (typeof OFFLOAD_JOB_STATUSES)[number];

export const eventOffloadJobs = pgTable(
  'event_offload_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    storageId: uuid('storage_id').references(() => tenantExternalStorage.id, { onDelete: 'set null' }),
    status: text('status').$type<OffloadJobStatus>().notNull().default('queued'),
    bytesOffloaded: bigint('bytes_offloaded', { mode: 'number' }),
    filesCount: integer('files_count'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    errorMessage: text('error_message'),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    statusEnum: check(
      'eoj_status',
      sql`${t.status} IN ('queued','running','completed','failed','cancelled')`,
    ),
    attemptBounds: check('eoj_attempt_bounds', sql`${t.attemptCount} BETWEEN 0 AND 50`),
    bytesNonNeg: check('eoj_bytes_non_neg', sql`${t.bytesOffloaded} IS NULL OR ${t.bytesOffloaded} >= 0`),
    filesNonNeg: check('eoj_files_non_neg', sql`${t.filesCount} IS NULL OR ${t.filesCount} >= 0`),
    eventIdx: index('idx_offload_jobs_event').on(t.eventId),
  }),
);
export type EventOffloadJob = typeof eventOffloadJobs.$inferSelect;
