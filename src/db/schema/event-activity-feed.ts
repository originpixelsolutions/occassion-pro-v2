import { sql } from 'drizzle-orm';
import { bigserial, boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';

export const ACTIVITY_ACTOR_TYPES = [
  'tenant_member','client','vendor','guest','speaker','system','super_admin',
] as const;
export type ActivityActorType = (typeof ACTIVITY_ACTOR_TYPES)[number];

export const ACTIVITY_SOURCES = [
  'web','mobile','api','webhook','worker','admin','import',
] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export const eventActivityFeed = pgTable(
  'event_activity_feed',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id'),
    actorType: text('actor_type').$type<ActivityActorType>().notNull(),
    actorNameCached: text('actor_name_cached'),
    activityType: text('activity_type').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    description: text('description').notNull(),
    data: jsonb('data').$type<{ before?: Record<string, unknown>; after?: Record<string, unknown>; [k: string]: unknown }>(),
    isInternal: boolean('is_internal').notNull().default(false),
    ipAddress: text('ip_address'), // SQL type inet
    source: text('source').$type<ActivitySource>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    actorTypeEnum: check(
      'eaf_actor_type',
      sql`${t.actorType} IN ('tenant_member','client','vendor','guest','speaker','system','super_admin')`,
    ),
    descLen: check('eaf_desc_len', sql`length(trim(${t.description})) BETWEEN 1 AND 2000`),
    dataObject: check('eaf_data_object', sql`${t.data} IS NULL OR jsonb_typeof(${t.data}) = 'object'`),
    eventTimeIdx: index('idx_activity_event_time').on(t.eventId, t.createdAt),
  }),
);
export type EventActivity = typeof eventActivityFeed.$inferSelect;
