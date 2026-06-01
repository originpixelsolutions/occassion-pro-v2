import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { tenants } from './tenants.js';

export interface EventWebsiteSection {
  type: string;
  title?: string;
  content?: Record<string, unknown>;
  order?: number;
}

export interface EventWebsiteTheme {
  primary_color?: string;
  secondary_color?: string;
  background_color?: string;
  font_family?: string;
  font_heading?: string;
}

export interface EventWebsiteSeo {
  title?: string;
  description?: string;
  og_image_url?: string;
  canonical_url?: string;
  no_index?: boolean;
}

export const eventWebsites = pgTable(
  'event_websites',
  {
    eventId: uuid('event_id').primaryKey().references(() => events.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    isPublished: boolean('is_published').notNull().default(false),
    sections: jsonb('sections').$type<{ items: EventWebsiteSection[] }>().notNull(),
    themeConfig: jsonb('theme_config').$type<EventWebsiteTheme>(),
    seoConfig: jsonb('seo_config').$type<EventWebsiteSeo>(),
    customCss: text('custom_css'),
    customHost: text('custom_host'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    sectionsObject: check(
      'ew_sections_object',
      sql`jsonb_typeof(${t.sections}) = 'object' AND octet_length(${t.sections}::text) < 2097152`,
    ),
    publishedCoupling: check(
      'ew_published_coupling',
      sql`(${t.isPublished} = FALSE AND ${t.publishedAt} IS NULL) OR (${t.isPublished} = TRUE AND ${t.publishedAt} IS NOT NULL)`,
    ),
    customHostFmt: check(
      'ew_custom_host_fmt',
      sql`${t.customHost} IS NULL OR ${t.customHost} ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}$'`,
    ),
    tenantIdx: index('idx_event_websites_tenant').on(t.tenantId),
  }),
);
export type EventWebsite = typeof eventWebsites.$inferSelect;
