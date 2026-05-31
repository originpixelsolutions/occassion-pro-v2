import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

export const SHEETS_RESOURCES = ['guests','vendors','runsheet','budget','payments'] as const;
export type SheetsResource = (typeof SHEETS_RESOURCES)[number];

export const SHEETS_SYNC_DIRECTIONS = ['to_sheets','from_sheets','two_way'] as const;
export type SheetsSyncDirection = (typeof SHEETS_SYNC_DIRECTIONS)[number];

export const SHEETS_STATUSES = ['active','expired','disconnected','error'] as const;
export type SheetsSyncStatus = (typeof SHEETS_STATUSES)[number];

export const tenantSheetsSyncs = pgTable(
  'tenant_sheets_syncs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(), // FK added in Phase 3
    resource: text('resource').$type<SheetsResource>().notNull(),
    sheetId: text('sheet_id').notNull(),
    sheetTabName: text('sheet_tab_name').notNull(),
    sheetUrl: text('sheet_url'),
    accessTokenEncrypted: bytea('access_token_encrypted').notNull(),
    refreshTokenEncrypted: bytea('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    syncDirection: text('sync_direction').$type<SheetsSyncDirection>().notNull().default('two_way'),
    columnMapping: jsonb('column_mapping').$type<Record<string, string>>().notNull(),
    configuredBy: uuid('configured_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    status: text('status').$type<SheetsSyncStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    resourceEnum: check(
      'tss_resource',
      sql`${t.resource} IN ('guests','vendors','runsheet','budget','payments')`,
    ),
    syncDirEnum: check(
      'tss_sync_direction',
      sql`${t.syncDirection} IN ('to_sheets','from_sheets','two_way')`,
    ),
    statusEnum: check('tss_status', sql`${t.status} IN ('active','expired','disconnected','error')`),
    tokenNonEmpty: check('tss_token_non_empty', sql`octet_length(${t.accessTokenEncrypted}) > 0`),
    mappingObject: check('tss_mapping_object', sql`jsonb_typeof(${t.columnMapping}) = 'object'`),
    sheetUrlHttps: check(
      'tss_sheet_url_https',
      sql`${t.sheetUrl} IS NULL OR ${t.sheetUrl} ~ '^https://docs\\.google\\.com/spreadsheets/'`,
    ),
    eventIdx: index('idx_tss_event').on(t.eventId),
  }),
);
export type TenantSheetsSync = typeof tenantSheetsSyncs.$inferSelect;
