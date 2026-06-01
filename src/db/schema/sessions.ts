import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';

export const SESSION_TYPES = ['keynote','panel','workshop','breakout','networking','exhibition'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    track: text('track'),
    sessionType: text('session_type').$type<SessionType>().notNull().default('breakout'),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    room: text('room'),
    capacity: integer('capacity'),
    isCpdEligible: boolean('is_cpd_eligible').notNull().default(false),
    cpdCredits: numeric('cpd_credits', { precision: 4, scale: 2 }),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    streamingUrl: text('streaming_url'),
    recordingUrl: text('recording_url'),
    languageCode: varchar('language_code', { length: 8 }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    eventTimeIx: index('idx_sessions_event_time').on(t.eventId, t.startsAt).where(sql`${t.deletedAt} IS NULL`),
    typeEnum: check('s_type_enum', sql`${t.sessionType} IN ('keynote','panel','workshop','breakout','networking','exhibition')`),
    timeOrder: check('s_time_order', sql`${t.endsAt} > ${t.startsAt}`),
    cpdRequiresEligible: check('s_cpd_requires_eligible', sql`${t.cpdCredits} IS NULL OR ${t.isCpdEligible} = TRUE`),
    publishRequiresAt: check('s_publish_requires_at', sql`${t.isPublished} = FALSE OR ${t.publishedAt} IS NOT NULL`),
  }),
);
export type Session = typeof sessions.$inferSelect;
