import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { floorPlans } from './floor-plans.js';

export const TABLE_SHAPES = ['round','rectangular','cocktail','banquet_row','square','oval'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export const floorPlanTables = pgTable(
  'floor_plan_tables',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    floorPlanId: uuid('floor_plan_id').notNull().references(() => floorPlans.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    tableNumber: text('table_number').notNull(),
    tableShape: text('table_shape').$type<TableShape>().notNull().default('round'),
    seatCount: integer('seat_count').notNull(),
    positionX: numeric('position_x', { precision: 10, scale: 2 }).notNull(),
    positionY: numeric('position_y', { precision: 10, scale: 2 }).notNull(),
    rotationDeg: numeric('rotation_deg', { precision: 5, scale: 2 }).notNull().default('0'),
    width: numeric('width', { precision: 10, scale: 2 }),
    height: numeric('height', { precision: 10, scale: 2 }),
    zone: text('zone'),
    label: text('label'),
    isVip: boolean('is_vip').notNull().default(false),
    isAccessible: boolean('is_accessible').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    numberUq: uniqueIndex('uq_floor_plan_tables_number')
      .on(t.floorPlanId, sql`lower(${t.tableNumber})`).where(sql`${t.deletedAt} IS NULL`),
    planIx: index('idx_floor_plan_tables_plan').on(t.floorPlanId).where(sql`${t.deletedAt} IS NULL`),
    shapeEnum: check('fpt_shape_enum', sql`${t.tableShape} IN ('round','rectangular','cocktail','banquet_row','square','oval')`),
    seatCountRange: check('fpt_seat_count_range', sql`${t.seatCount} > 0 AND ${t.seatCount} <= 100`),
    rotationRange: check('fpt_rotation_range', sql`${t.rotationDeg} >= 0 AND ${t.rotationDeg} < 360`),
  }),
);
export type FloorPlanTable = typeof floorPlanTables.$inferSelect;
