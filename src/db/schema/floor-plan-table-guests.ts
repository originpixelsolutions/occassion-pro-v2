import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { guests } from './guests.js';
import { tenantMembers } from './tenant-members.js';
import { floorPlanTables } from './floor-plan-tables.js';

export const floorPlanTableGuests = pgTable(
  'floor_plan_table_guests',
  {
    tableId: uuid('table_id').notNull().references(() => floorPlanTables.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id').notNull().references(() => guests.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    seatNumber: integer('seat_number'),
    assignedBy: uuid('assigned_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().default(sql`now()`),
    isPlusOne: boolean('is_plus_one').notNull().default(false),
    notes: text('notes'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tableId, t.guestId] }),
    seatUq: uniqueIndex('uq_floor_plan_table_guests_seat')
      .on(t.tableId, t.seatNumber).where(sql`${t.seatNumber} IS NOT NULL`),
    guestIx: index('idx_fp_table_guests_guest').on(t.guestId),
    seatRange: check('fptg_seat_range', sql`${t.seatNumber} IS NULL OR (${t.seatNumber} > 0 AND ${t.seatNumber} <= 100)`),
  }),
);
export type FloorPlanTableGuest = typeof floorPlanTableGuests.$inferSelect;
