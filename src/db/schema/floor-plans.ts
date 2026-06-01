import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';

export const floorPlans = pgTable(
  'floor_plans',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    canvas: jsonb('canvas').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    width: integer('width'),
    height: integer('height'),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    nameUq: uniqueIndex('uq_floor_plans_event_name_active')
      .on(t.eventId, sql`lower(${t.name})`).where(sql`${t.deletedAt} IS NULL`),
    eventIx: index('idx_floor_plans_event').on(t.eventId).where(sql`${t.deletedAt} IS NULL`),
    publishCoupling: check('fp_publish_coupling', sql`${t.isPublished} = FALSE OR (${t.publishedAt} IS NOT NULL AND ${t.publishedBy} IS NOT NULL)`),
  }),
);
export type FloorPlan = typeof floorPlans.$inferSelect;
