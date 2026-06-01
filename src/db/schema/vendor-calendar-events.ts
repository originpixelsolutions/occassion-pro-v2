import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { vendorAccounts } from './vendor-accounts.js';
import { vendorExternalCalendars } from './vendor-external-calendars.js';

export const VENDOR_CALENDAR_EVENT_STATUSES = ['confirmed', 'tentative', 'cancelled'] as const;
export type VendorCalendarEventStatus = (typeof VENDOR_CALENDAR_EVENT_STATUSES)[number];

export const vendorCalendarEvents = pgTable(
  'vendor_calendar_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    vendorCalendarId: uuid('vendor_calendar_id')
      .notNull()
      .references(() => vendorExternalCalendars.id, { onDelete: 'cascade' }),
    vendorAccountId: uuid('vendor_account_id')
      .notNull()
      .references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    externalEventId: text('external_event_id').notNull(),
    title: text('title'),
    location: text('location'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').notNull().default(false),
    busy: boolean('busy').notNull().default(true),
    status: text('status').$type<VendorCalendarEventStatus>().notNull().default('confirmed'),
    recurrenceRule: text('recurrence_rule'),
    externalUrl: text('external_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    externalEtag: text('external_etag'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    externalUq: uniqueIndex('uq_vendor_calendar_events_external').on(
      t.vendorCalendarId,
      t.externalEventId,
    ),
    timeIx: index('idx_vendor_cal_events_time').on(t.vendorCalendarId, t.startsAt, t.endsAt),
    busyIx: index('idx_vendor_cal_events_busy')
      .on(t.vendorAccountId, t.startsAt, t.endsAt)
      .where(sql`${t.busy} = TRUE AND ${t.status} <> 'cancelled'`),
    statusEnum: check('vce_status_enum', sql`${t.status} IN ('confirmed','tentative','cancelled')`),
    timeOrder: check('vce_time_order', sql`${t.endsAt} >= ${t.startsAt}`),
  }),
);
export type VendorCalendarEvent = typeof vendorCalendarEvents.$inferSelect;
