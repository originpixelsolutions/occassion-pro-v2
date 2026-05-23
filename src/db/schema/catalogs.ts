import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core';

export const storageAddonsCatalog = pgTable(
  'storage_addons_catalog',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    code: text('code').unique().notNull(),
    name: text('name').notNull(),
    extraGb: integer('extra_gb').notNull(),
    priceInrMonthly: numeric('price_inr_monthly', { precision: 10, scale: 2 }),
    priceInrYearly: numeric('price_inr_yearly', { precision: 10, scale: 2 }),
    priceUsdMonthly: numeric('price_usd_monthly', { precision: 10, scale: 2 }),
    priceUsdYearly: numeric('price_usd_yearly', { precision: 10, scale: 2 }),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    statusIdx: index('idx_storage_addons_catalog_status')
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
  }),
);
export type StorageAddon = typeof storageAddonsCatalog.$inferSelect;

export const ADDON_CATEGORIES = ['capacity', 'feature', 'communication', 'ai', 'support'] as const;
export type AddonCategory = (typeof ADDON_CATEGORIES)[number];

export const addonsCatalog = pgTable(
  'addons_catalog',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    code: text('code').unique().notNull(),
    name: text('name').notNull(),
    category: text('category').$type<AddonCategory>().notNull(),
    description: text('description'),
    priceInrMonthly: numeric('price_inr_monthly', { precision: 10, scale: 2 }),
    priceInrYearly: numeric('price_inr_yearly', { precision: 10, scale: 2 }),
    priceUsdMonthly: numeric('price_usd_monthly', { precision: 10, scale: 2 }),
    priceUsdYearly: numeric('price_usd_yearly', { precision: 10, scale: 2 }),
    appliesToPlans: text('applies_to_plans').array(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    categoryIdx: index('idx_addons_catalog_category')
      .on(t.category)
      .where(sql`${t.status} = 'active'`),
  }),
);
export type Addon = typeof addonsCatalog.$inferSelect;
