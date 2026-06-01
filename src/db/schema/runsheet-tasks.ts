import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';
import { eventSubteams } from './event-subteams.js';

export const RUNSHEET_TASK_STATUSES = [
  'pending',
  'blocked',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type RunsheetTaskStatus = (typeof RUNSHEET_TASK_STATUSES)[number];

export const RUNSHEET_TASK_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type RunsheetTaskPriority = (typeof RUNSHEET_TASK_PRIORITIES)[number];

export const runsheetTasks = pgTable(
  'runsheet_tasks',
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
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => runsheetTasks.id, {
      onDelete: 'set null',
    }),
    dependsOnId: uuid('depends_on_id').references((): AnyPgColumn => runsheetTasks.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
    actualStart: timestamp('actual_start', { withTimezone: true }),
    actualEnd: timestamp('actual_end', { withTimezone: true }),
    assignedTo: uuid('assigned_to').references(() => tenantMembers.id, { onDelete: 'set null' }),
    subteamId: uuid('subteam_id').references(() => eventSubteams.id, { onDelete: 'set null' }),
    status: text('status').$type<RunsheetTaskStatus>().notNull().default('pending'),
    priority: text('priority').$type<RunsheetTaskPriority>().notNull().default('normal'),
    sortOrder: integer('sort_order').notNull().default(0),
    blockedReason: text('blocked_reason'),
    cancelledReason: text('cancelled_reason'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    eventTimeIx: index('idx_runsheet_tasks_event_time')
      .on(t.eventId, t.scheduledStart)
      .where(sql`${t.deletedAt} IS NULL`),
    statusEnum: check(
      'rt_status_enum',
      sql`${t.status} IN ('pending','blocked','in_progress','completed','cancelled')`,
    ),
    priorityEnum: check(
      'rt_priority_enum',
      sql`${t.priority} IN ('low','normal','high','critical')`,
    ),
    noSelfDep: check('rt_no_self_dep', sql`${t.id} <> ${t.dependsOnId}`),
    noSelfParent: check('rt_no_self_parent', sql`${t.id} <> ${t.parentTaskId}`),
  }),
);
export type RunsheetTask = typeof runsheetTasks.$inferSelect;
