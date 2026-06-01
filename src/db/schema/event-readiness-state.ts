import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { eventTypeReadinessItems } from './event-type-readiness-items.js';
import { tenantMembers } from './tenant-members.js';

export const eventReadinessState = pgTable(
  'event_readiness_state',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => eventTypeReadinessItems.id, { onDelete: 'cascade' }),
    isComplete: boolean('is_complete').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.itemId] }),
    completionCoupling: check(
      'ers_completion_coupling',
      sql`(${t.isComplete} = FALSE AND ${t.completedAt} IS NULL AND ${t.completedBy} IS NULL)
       OR (${t.isComplete} = TRUE  AND ${t.completedAt} IS NOT NULL)`,
    ),
    itemIdx: index('idx_readiness_state_item').on(t.itemId),
  }),
);
export type EventReadinessState = typeof eventReadinessState.$inferSelect;
