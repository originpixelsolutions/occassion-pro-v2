import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { eventTypes } from './event-types.js';
import type { PermissionModule } from './module-permissions.js';

export const eventTypeReadinessItems = pgTable(
  'event_type_readiness_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    eventTypeId: uuid('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    description: text('description'),
    module: text('module').$type<PermissionModule>(),
    checkQuery: text('check_query'),
    weight: integer('weight').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    labelLen: check('etri_label_len', sql`length(trim(${t.label})) BETWEEN 1 AND 200`),
    weightBounds: check('etri_weight_bounds', sql`${t.weight} BETWEEN 0 AND 100`),
    typeIdx: index('idx_readiness_items_type').on(t.eventTypeId),
  }),
);
export type EventTypeReadinessItem = typeof eventTypeReadinessItems.$inferSelect;
