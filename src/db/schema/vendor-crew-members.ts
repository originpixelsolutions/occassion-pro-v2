import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext } from '../columns.js';
import { vendorAccounts } from './vendor-accounts.js';

export const VENDOR_CREW_ROLES = [
  'head_chef',
  'sous_chef',
  'server',
  'bartender',
  'photographer',
  'videographer',
  'sound_engineer',
  'lighting_tech',
  'stage_manager',
  'decorator',
  'driver',
  'security',
  'assistant',
  'floor_manager',
  'other',
] as const;
export type VendorCrewRole = (typeof VENDOR_CREW_ROLES)[number];

export const VENDOR_CREW_STATUSES = ['active', 'inactive'] as const;
export type VendorCrewStatus = (typeof VENDOR_CREW_STATUSES)[number];

export const vendorCrewMembers = pgTable(
  'vendor_crew_members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    vendorAccountId: uuid('vendor_account_id')
      .notNull()
      .references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    role: text('role').$type<VendorCrewRole>(),
    phone: text('phone'),
    email: citext('email'),
    hourlyRate: numeric('hourly_rate', { precision: 10, scale: 2 }),
    currencyCode: varchar('currency_code', { length: 3 }),
    notes: text('notes'),
    status: text('status').$type<VendorCrewStatus>().notNull().default('active'),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivatedReason: text('deactivated_reason'),
    addedAt: timestamp('added_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    vendorIx: index('idx_vendor_crew')
      .on(t.vendorAccountId)
      .where(sql`${t.deletedAt} IS NULL`),
    statusEnum: check('vcm_status_enum', sql`${t.status} IN ('active','inactive')`),
    rateCurrencyCoupling: check(
      'vcm_rate_currency',
      sql`(${t.hourlyRate} IS NULL) = (${t.currencyCode} IS NULL)`,
    ),
    inactiveCoupling: check(
      'vcm_inactive_coupling',
      sql`${t.status} <> 'inactive' OR ${t.deactivatedAt} IS NOT NULL`,
    ),
  }),
);
export type VendorCrewMember = typeof vendorCrewMembers.$inferSelect;
