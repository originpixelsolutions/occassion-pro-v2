import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';

export const runsheetVersions = pgTable(
  'runsheet_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    isFull: boolean('is_full').notNull().default(false),
    snapshot: jsonb('snapshot'),
    diff: jsonb('diff'),
    baseVersionId: uuid('base_version_id').references((): AnyPgColumn => runsheetVersions.id, {
      onDelete: 'set null',
    }),
    versionLabel: text('version_label'),
    taskCount: integer('task_count'),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
  },
  (t) => ({
    eventTimeIx: index('idx_runsheet_versions_event_time')
      .on(t.eventId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    noSelfBase: check('rv_no_self_base', sql`${t.id} <> ${t.baseVersionId}`),
    fullOrDiff: check(
      'rv_full_or_diff',
      sql`
      (${t.isFull} = TRUE  AND ${t.snapshot} IS NOT NULL AND ${t.diff} IS NULL AND ${t.baseVersionId} IS NULL)
      OR (${t.isFull} = FALSE AND ${t.diff} IS NOT NULL AND ${t.baseVersionId} IS NOT NULL AND ${t.snapshot} IS NULL)
    `,
    ),
  }),
);
export type RunsheetVersion = typeof runsheetVersions.$inferSelect;
