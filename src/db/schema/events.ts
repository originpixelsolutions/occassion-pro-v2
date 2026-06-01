import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { eventTypes } from './event-types.js';
import { eventTemplates } from './event-templates.js';
import { tenantMembers } from './tenant-members.js';

export const EVENT_STATUSES = [
  'planning',
  'live',
  'completed',
  'cancelled',
  'archived',
  'offloaded',
  'deleted_media',
  'deleted',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const OFFLOAD_DESTINATIONS = [
  'google_drive',
  'dropbox',
  'onedrive',
  's3',
  'r2',
  'b2',
  'wasabi',
] as const;
export type OffloadDestination = (typeof OFFLOAD_DESTINATIONS)[number];

export const events = pgTable(
  'events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventTypeId: uuid('event_type_id')
      .notNull()
      .references(() => eventTypes.id, { onDelete: 'restrict' }),
    templateId: uuid('template_id').references(() => eventTemplates.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    bannerUrl: text('banner_url'),
    venueName: text('venue_name'),
    venueAddress: text('venue_address'),
    venueCity: text('venue_city'),
    venueCountry: varchar('venue_country', { length: 2 }),
    venueLat: numeric('venue_lat', { precision: 9, scale: 6 }),
    venueLng: numeric('venue_lng', { precision: 9, scale: 6 }),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    expectedGuestCount: integer('expected_guest_count'),
    maxGuestCount: integer('max_guest_count'),
    primaryClientName: text('primary_client_name'),
    status: text('status').$type<EventStatus>().notNull().default('planning'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    offloadedAt: timestamp('offloaded_at', { withTimezone: true }),
    offloadDestination: text('offload_destination').$type<OffloadDestination>(),
    offloadLocationUrl: text('offload_location_url'),
    offloadSizeBytes: bigint('offload_size_bytes', { mode: 'number' }),
    guestsAnonymizedAt: timestamp('guests_anonymized_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tenantCodeUq: uniqueIndex('uq_events_tenant_code').on(t.tenantId, t.code),
    codeFmt: check('e_code_fmt', sql`${t.code} ~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$'`),
    statusEnum: check(
      'e_status',
      sql`${t.status} IN ('planning','live','completed','cancelled','archived','offloaded','deleted_media','deleted')`,
    ),
    currencyFmt: check('e_currency_fmt', sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
    dateOrder: check('e_date_order', sql`${t.endDate} > ${t.startDate}`),
    coordCoupling: check(
      'e_coord_coupling',
      sql`(${t.venueLat} IS NULL) = (${t.venueLng} IS NULL)`,
    ),
    tenantStatusIdx: index('idx_events_tenant_status').on(t.tenantId, t.status),
  }),
);
export type EventRow = typeof events.$inferSelect;
