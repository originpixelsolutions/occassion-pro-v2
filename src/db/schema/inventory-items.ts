import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const INVENTORY_CATEGORIES = [
  'tables',
  'chairs',
  'decor',
  'av',
  'lighting',
  'kitchen',
  'linen',
  'crockery',
  'signage',
  'other',
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const INVENTORY_STATUSES = ['active', 'retired'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').$type<InventoryCategory>(),
    sku: text('sku'),
    description: text('description'),
    unitCost: numeric('unit_cost', { precision: 10, scale: 2 }),
    unitReplacementCost: numeric('unit_replacement_cost', { precision: 10, scale: 2 }),
    currencyCode: varchar('currency_code', { length: 3 }),
    quantityTotal: integer('quantity_total').notNull().default(0),
    quantityInStock: integer('quantity_in_stock').notNull().default(0),
    quantityInUse: integer('quantity_in_use').notNull().default(0),
    quantityDamaged: integer('quantity_damaged').notNull().default(0),
    storageLocation: text('storage_location'),
    imageUrl: text('image_url'),
    status: text('status').$type<InventoryStatus>().notNull().default('active'),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retiredReason: text('retired_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
  },
  (t) => ({
    skuUq: uniqueIndex('uq_inventory_items_sku')
      .on(t.tenantId, sql`lower(${t.sku})`)
      .where(sql`${t.sku} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    tenantStatusIx: index('idx_inventory_tenant')
      .on(t.tenantId, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    statusEnum: check('inv_status_enum', sql`${t.status} IN ('active','retired')`),
    qtyInvariant: check(
      'inv_qty_invariant',
      sql`${t.quantityInStock} + ${t.quantityInUse} + ${t.quantityDamaged} <= ${t.quantityTotal}`,
    ),
    costCurrencyCoupling: check(
      'inv_cost_currency',
      sql`(${t.unitCost} IS NULL AND ${t.unitReplacementCost} IS NULL) OR ${t.currencyCode} IS NOT NULL`,
    ),
    retiredCoupling: check(
      'inv_retired_coupling',
      sql`${t.status} <> 'retired' OR ${t.retiredAt} IS NOT NULL`,
    ),
  }),
);
export type InventoryItem = typeof inventoryItems.$inferSelect;
