import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { vendorAccounts } from './vendor-accounts.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const VENDOR_CALENDAR_PROVIDERS = [
  'google_calendar',
  'outlook',
  'apple_calendar',
  'ical_url',
] as const;
export type VendorCalendarProvider = (typeof VENDOR_CALENDAR_PROVIDERS)[number];

export const VENDOR_CALENDAR_STATUSES = ['active', 'expired', 'disconnected', 'error'] as const;
export type VendorCalendarStatus = (typeof VENDOR_CALENDAR_STATUSES)[number];

export const vendorExternalCalendars = pgTable(
  'vendor_external_calendars',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    vendorAccountId: uuid('vendor_account_id')
      .notNull()
      .references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<VendorCalendarProvider>().notNull(),
    accessTokenEncrypted: bytea('access_token_encrypted'),
    refreshTokenEncrypted: bytea('refresh_token_encrypted'),
    tokenKmsKeyId: text('token_kms_key_id'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    icalUrl: text('ical_url'),
    calendarId: text('calendar_id'),
    displayName: text('display_name'),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: text('status').$type<VendorCalendarStatus>().notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    syncErrorCount: integer('sync_error_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    primaryUq: uniqueIndex('uq_vendor_external_calendars_primary')
      .on(t.vendorAccountId)
      .where(sql`${t.isPrimary} = TRUE AND ${t.deletedAt} IS NULL`),
    vendorIx: index('idx_vendor_calendars_vendor')
      .on(t.vendorAccountId)
      .where(sql`${t.status} = 'active' AND ${t.deletedAt} IS NULL`),
    providerEnum: check(
      'vec_provider_enum',
      sql`${t.provider} IN ('google_calendar','outlook','apple_calendar','ical_url')`,
    ),
    statusEnum: check(
      'vec_status_enum',
      sql`${t.status} IN ('active','expired','disconnected','error')`,
    ),
    icalRequiresUrl: check(
      'vec_ical_requires_url',
      sql`${t.provider} <> 'ical_url' OR ${t.icalUrl} IS NOT NULL`,
    ),
    tokensRequireKey: check(
      'vec_tokens_require_key',
      sql`(${t.accessTokenEncrypted} IS NULL AND ${t.refreshTokenEncrypted} IS NULL) OR ${t.tokenKmsKeyId} IS NOT NULL`,
    ),
  }),
);
export type VendorExternalCalendar = typeof vendorExternalCalendars.$inferSelect;
