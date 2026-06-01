import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { vendorAccounts } from './vendor-accounts.js';
import { superAdmins } from './super-admins.js';

const textArray = customType<{ data: string[] | null; driverData: string }>({
  dataType() {
    return 'text[]';
  },
});

export const VENDOR_PORTFOLIO_VISIBILITIES = ['private', 'tenants_only', 'public'] as const;
export type VendorPortfolioVisibility = (typeof VENDOR_PORTFOLIO_VISIBILITIES)[number];

export const vendorPortfolios = pgTable(
  'vendor_portfolios',
  {
    vendorAccountId: uuid('vendor_account_id')
      .primaryKey()
      .references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    aboutText: text('about_text'),
    serviceCategories: textArray('service_categories'),
    serviceRegions: textArray('service_regions'),
    startingPrice: numeric('starting_price', { precision: 14, scale: 2 }),
    startingCurrency: varchar('starting_currency', { length: 3 }),
    yearsInBusiness: integer('years_in_business'),
    totalEventsServed: integer('total_events_served').notNull().default(0),
    avgPerformanceRating: numeric('avg_performance_rating', { precision: 3, scale: 2 }),
    totalRatingsCount: integer('total_ratings_count').notNull().default(0),
    coverImageUrl: text('cover_image_url'),
    galleryImageUrls: textArray('gallery_image_urls'),
    socialLinks: jsonb('social_links'),
    awards: jsonb('awards'),
    certifications: jsonb('certifications'),
    slug: text('slug'),
    visibility: text('visibility').$type<VendorPortfolioVisibility>().notNull().default('private'),
    isVerified: boolean('is_verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by').references(() => superAdmins.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    slugUq: uniqueIndex('vendor_portfolios_slug_key').on(t.slug),
    visibilityEnum: check(
      'vp_visibility_enum',
      sql`${t.visibility} IN ('private','tenants_only','public')`,
    ),
    priceCurrencyCoupling: check(
      'vp_price_currency',
      sql`(${t.startingPrice} IS NULL) = (${t.startingCurrency} IS NULL)`,
    ),
    ratingCountCoupling: check(
      'vp_rating_count',
      sql`(${t.avgPerformanceRating} IS NULL AND ${t.totalRatingsCount} = 0) OR (${t.avgPerformanceRating} IS NOT NULL AND ${t.totalRatingsCount} > 0)`,
    ),
    verifiedCoupling: check(
      'vp_verified_coupling',
      sql`NOT ${t.isVerified} OR (${t.verifiedAt} IS NOT NULL AND ${t.verifiedBy} IS NOT NULL)`,
    ),
  }),
);
export type VendorPortfolio = typeof vendorPortfolios.$inferSelect;
