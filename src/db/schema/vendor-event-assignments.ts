import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';
import { vendorAccounts } from './vendor-accounts.js';

export const VENDOR_ASSIGNMENT_STATUSES = [
  'invited',
  'accepted',
  'declined',
  'completed',
  'cancelled',
] as const;
export type VendorAssignmentStatus = (typeof VENDOR_ASSIGNMENT_STATUSES)[number];

export const vendorEventAssignments = pgTable(
  'vendor_event_assignments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    vendorAccountId: uuid('vendor_account_id')
      .notNull()
      .references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    serviceCategory: text('service_category').notNull(),
    status: text('status').$type<VendorAssignmentStatus>().notNull().default('invited'),
    contractValue: numeric('contract_value', { precision: 14, scale: 2 }),
    currencyCode: varchar('currency_code', { length: 3 }),
    assignedBy: uuid('assigned_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    declinedReason: text('declined_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    performanceRating: numeric('performance_rating', { precision: 2, scale: 1 }),
    performanceNotes: text('performance_notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    activeUq: uniqueIndex('uq_vendor_event_assignments_active')
      .on(t.vendorAccountId, t.eventId, sql`lower(${t.serviceCategory})`)
      .where(sql`${t.deletedAt} IS NULL`),
    eventStatusIx: index('idx_vendor_assignments_status')
      .on(t.eventId, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    statusEnum: check(
      'vea_status_enum',
      sql`${t.status} IN ('invited','accepted','declined','completed','cancelled')`,
    ),
    valueCurrencyCoupling: check(
      'vea_value_currency_coupling',
      sql`(${t.contractValue} IS NULL) = (${t.currencyCode} IS NULL)`,
    ),
    ratingRequiresCompleted: check(
      'vea_rating_requires_completed',
      sql`${t.performanceRating} IS NULL OR ${t.status} = 'completed'`,
    ),
  }),
);
export type VendorEventAssignment = typeof vendorEventAssignments.$inferSelect;
