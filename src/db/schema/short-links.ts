import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { guests } from './guests.js';
import { tenantMembers } from './tenant-members.js';

export const SHORT_LINK_TYPES = [
  'invitation',
  'rsvp',
  'portal',
  'website',
  'badge',
  'asset',
  'generic',
] as const;
export type ShortLinkType = (typeof SHORT_LINK_TYPES)[number];

export const shortLinks = pgTable(
  'short_links',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    code: text('code').notNull(),
    customAlias: text('custom_alias'),
    destinationUrl: text('destination_url').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id').references(() => guests.id, { onDelete: 'set null' }),
    linkType: text('link_type').$type<ShortLinkType>().notNull(),
    passwordHash: text('password_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    clickCount: integer('click_count').notNull().default(0),
    lastClickedAt: timestamp('last_clicked_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
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
    codeUq: uniqueIndex('short_links_code_key').on(t.code),
    aliasUq: uniqueIndex('short_links_custom_alias_key').on(t.customAlias),
    activeIx: index('idx_short_links_active')
      .on(t.code)
      .where(sql`${t.isActive} = TRUE AND ${t.deletedAt} IS NULL`),
    typeEnum: check(
      'sl_type_enum',
      sql`${t.linkType} IN ('invitation','rsvp','portal','website','badge','asset','generic')`,
    ),
    clickNonNeg: check('sl_click_non_neg', sql`${t.clickCount} >= 0`),
  }),
);
export type ShortLink = typeof shortLinks.$inferSelect;
