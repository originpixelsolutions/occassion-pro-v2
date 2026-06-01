import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';
import { inventoryItems } from './inventory-items.js';

export const INVENTORY_ALLOC_STATUSES = [
  'allocated',
  'dispatched',
  'returned',
  'damaged',
  'lost',
  'cancelled',
] as const;
export type InventoryAllocStatus = (typeof INVENTORY_ALLOC_STATUSES)[number];

export const inventoryAllocations = pgTable(
  'inventory_allocations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    quantityDamaged: integer('quantity_damaged').notNull().default(0),
    quantityLost: integer('quantity_lost').notNull().default(0),
    quantityReturned: integer('quantity_returned').notNull().default(0),
    status: text('status').$type<InventoryAllocStatus>().notNull().default('allocated'),
    allocatedAt: timestamp('allocated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    damageNotes: text('damage_notes'),
    damageCost: numeric('damage_cost', { precision: 10, scale: 2 }),
    damageCurrency: varchar('damage_currency', { length: 3 }),
    allocatedBy: uuid('allocated_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    dispatchedBy: uuid('dispatched_by').references(() => tenantMembers.id, {
      onDelete: 'set null',
    }),
    receivedBy: uuid('received_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    eventStatusIx: index('idx_inv_alloc_status').on(t.eventId, t.status),
    statusEnum: check(
      'ia_status_enum',
      sql`${t.status} IN ('allocated','dispatched','returned','damaged','lost','cancelled')`,
    ),
    qtyInvariant: check(
      'ia_qty_invariant',
      sql`${t.quantityDamaged} + ${t.quantityLost} + ${t.quantityReturned} <= ${t.quantity}`,
    ),
    damageCostCoupling: check(
      'ia_damage_cost_coupling',
      sql`(${t.damageCost} IS NULL) = (${t.damageCurrency} IS NULL)`,
    ),
  }),
);
export type InventoryAllocation = typeof inventoryAllocations.$inferSelect;
