import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { shortLinks } from './short-links.js';

export const CLICK_DEVICE_TYPES = ['mobile', 'tablet', 'desktop', 'bot', 'other'] as const;
export type ClickDeviceType = (typeof CLICK_DEVICE_TYPES)[number];

export const CLICK_OUTCOMES = [
  'success',
  'password_required',
  'password_failed',
  'expired',
  'inactive',
  'not_found',
  'rate_limited',
] as const;
export type ClickOutcome = (typeof CLICK_OUTCOMES)[number];

export const shortLinkClicks = pgTable(
  'short_link_clicks',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => shortLinks.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clickedAt: timestamp('clicked_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    deviceType: text('device_type').$type<ClickDeviceType>(),
    osFamily: text('os_family'),
    browserFamily: text('browser_family'),
    referrer: text('referrer'),
    countryCode: varchar('country_code', { length: 2 }),
    regionCode: varchar('region_code', { length: 8 }),
    city: text('city'),
    outcome: text('outcome').$type<ClickOutcome>().notNull().default('success'),
  },
  (t) => ({
    linkTimeIx: index('idx_short_link_clicks_link').on(t.linkId, t.clickedAt),
    deviceEnum: check(
      'slc_device_enum',
      sql`${t.deviceType} IS NULL OR ${t.deviceType} IN ('mobile','tablet','desktop','bot','other')`,
    ),
    outcomeEnum: check(
      'slc_outcome_enum',
      sql`${t.outcome} IN ('success','password_required','password_failed','expired','inactive','not_found','rate_limited')`,
    ),
  }),
);
export type ShortLinkClick = typeof shortLinkClicks.$inferSelect;
