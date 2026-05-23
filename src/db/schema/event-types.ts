import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  interval,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const EVENT_TYPE_TONES = ['celebratory', 'solemn', 'formal', 'playful'] as const;
export type EventTypeTone = (typeof EVENT_TYPE_TONES)[number];

export const eventTypes = pgTable(
  'event_types',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    icon: text('icon'),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    tone: text('tone').$type<EventTypeTone>().notNull().default('celebratory'),
    defaultFnbStyle: text('default_fnb_style'),
    defaultSessionDuration: interval('default_session_duration'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    systemCodeUq: uniqueIndex('idx_event_types_system_code')
      .on(t.code)
      .where(sql`${t.tenantId} IS NULL`),
    tenantCodeUq: uniqueIndex('idx_event_types_tenant_code')
      .on(t.tenantId, t.code)
      .where(sql`${t.tenantId} IS NOT NULL`),
  }),
);
export type EventType = typeof eventTypes.$inferSelect;

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
    module: text('module'),
    checkQuery: text('check_query'),
    weight: integer('weight').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({ typeIdx: index('idx_readiness_items_type').on(t.eventTypeId) }),
);
export type EventTypeReadinessItem = typeof eventTypeReadinessItems.$inferSelect;
