import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { eventTypes } from './event-types.js';

export const eventTemplates = pgTable(
  'event_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    coverImageUrl: text('cover_image_url'),
    eventTypeId: uuid('event_type_id').references(() => eventTypes.id, { onDelete: 'cascade' }),
    scaffold: jsonb('scaffold').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    isPublished: boolean('is_published').notNull().default(true),
    useCount: integer('use_count').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    typeIdx: index('idx_templates_type').on(t.eventTypeId),
    systemIdx: index('idx_templates_system')
      .on(t.isSystem)
      .where(sql`${t.isSystem} = true`),
  }),
);
export type EventTemplate = typeof eventTemplates.$inferSelect;
