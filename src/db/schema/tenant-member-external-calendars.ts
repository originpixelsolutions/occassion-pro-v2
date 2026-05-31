import { sql } from 'drizzle-orm';
import { check, customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantMembers } from './tenant-members.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const CALENDAR_PROVIDERS = ['google_calendar', 'outlook', 'apple_calendar'] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

export const CALENDAR_SYNC_DIRECTIONS = ['read_only', 'two_way'] as const;
export type CalendarSyncDirection = (typeof CALENDAR_SYNC_DIRECTIONS)[number];

export const CALENDAR_STATUSES = ['active', 'expired', 'disconnected'] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

export const tenantMemberExternalCalendars = pgTable(
  'tenant_member_external_calendars',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    memberId: uuid('member_id')
      .notNull()
      .references(() => tenantMembers.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<CalendarProvider>().notNull(),
    accessTokenEncrypted: bytea('access_token_encrypted').notNull(),
    refreshTokenEncrypted: bytea('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    calendarId: text('calendar_id'),
    syncDirection: text('sync_direction')
      .$type<CalendarSyncDirection>()
      .notNull()
      .default('two_way'),
    status: text('status').$type<CalendarStatus>().notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    providerEnum: check(
      'tmec_provider',
      sql`${t.provider} IN ('google_calendar','outlook','apple_calendar')`,
    ),
    syncDirEnum: check('tmec_sync_direction', sql`${t.syncDirection} IN ('read_only','two_way')`),
    statusEnum: check('tmec_status', sql`${t.status} IN ('active','expired','disconnected')`),
    tokenNonEmpty: check('tmec_token_non_empty', sql`octet_length(${t.accessTokenEncrypted}) > 0`),
    expiredConsistency: check(
      'tmec_expired_consistency',
      sql`${t.status} <> 'expired' OR ${t.tokenExpiresAt} IS NOT NULL`,
    ),
    providerIdx: index('idx_tmec_provider').on(t.provider),
  }),
);
export type TenantMemberExternalCalendar = typeof tenantMemberExternalCalendars.$inferSelect;
