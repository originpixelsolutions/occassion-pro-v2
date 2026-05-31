import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { addonsCatalog } from './catalogs.js';

export const TENANT_ADDON_STATUSES = ['active', 'cancelled', 'past_due'] as const;
export type TenantAddonStatus = (typeof TENANT_ADDON_STATUSES)[number];

export const tenantAddons = pgTable(
  'tenant_addons',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    addonId: uuid('addon_id')
      .notNull()
      .references(() => addonsCatalog.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull().default(1),
    status: text('status').$type<TenantAddonStatus>().notNull().default('active'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    qtyBounds: check('ta_qty_bounds', sql`${t.quantity} > 0 AND ${t.quantity} <= 1000`),
    statusEnum: check('ta_status', sql`${t.status} IN ('active','cancelled','past_due')`),
    periodOrder: check(
      'ta_period_order',
      sql`${t.currentPeriodEnd} IS NULL OR ${t.currentPeriodStart} IS NULL OR ${t.currentPeriodEnd} > ${t.currentPeriodStart}`,
    ),
    cancelledRequiresTs: check(
      'ta_cancelled_requires_ts',
      sql`${t.status} <> 'cancelled' OR ${t.cancelledAt} IS NOT NULL`,
    ),
    addonIdx: index('idx_ta_addon').on(t.addonId),
  }),
);
export type TenantAddon = typeof tenantAddons.$inferSelect;
