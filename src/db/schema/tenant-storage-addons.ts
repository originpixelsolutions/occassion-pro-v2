import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { storageAddonsCatalog } from './catalogs.js';

export const STORAGE_ADDON_STATUSES = ['active', 'cancelled', 'past_due'] as const;
export type StorageAddonStatus = (typeof STORAGE_ADDON_STATUSES)[number];

export const tenantStorageAddons = pgTable(
  'tenant_storage_addons',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    addonId: uuid('addon_id')
      .notNull()
      .references(() => storageAddonsCatalog.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull().default(1),
    status: text('status').$type<StorageAddonStatus>().notNull().default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationCooldownUntil: timestamp('cancellation_cooldown_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    qtyBounds: check('tsa_qty_bounds', sql`${t.quantity} > 0 AND ${t.quantity} <= 100`),
    statusEnum: check('tsa_status', sql`${t.status} IN ('active','cancelled','past_due')`),
    periodOrder: check(
      'tsa_period_order',
      sql`${t.currentPeriodEnd} IS NULL OR ${t.currentPeriodStart} IS NULL OR ${t.currentPeriodEnd} > ${t.currentPeriodStart}`,
    ),
    cancelledRequiresTs: check(
      'tsa_cancelled_requires_ts',
      sql`${t.status} <> 'cancelled' OR ${t.cancelledAt} IS NOT NULL`,
    ),
    addonIdx: index('idx_tsa_addon').on(t.addonId),
  }),
);
export type TenantStorageAddon = typeof tenantStorageAddons.$inferSelect;
