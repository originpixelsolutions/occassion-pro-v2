import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';

export const eventSubteams = pgTable(
  'event_subteams',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colorHex: text('color_hex'),
    description: text('description'),
    leadId: uuid('lead_id').references(() => tenantMembers.id, { onDelete: 'set null' }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    nameLen: check('es_name_len', sql`length(trim(${t.name})) BETWEEN 1 AND 120`),
    colorFmt: check(
      'es_color_fmt',
      sql`${t.colorHex} IS NULL OR ${t.colorHex} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    eventIdx: index('idx_event_subteams_event').on(t.eventId),
  }),
);
export type EventSubteam = typeof eventSubteams.$inferSelect;
