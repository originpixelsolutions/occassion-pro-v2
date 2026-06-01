import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { vendorAccounts } from './vendor-accounts.js';
import { vendorEventAssignments } from './vendor-event-assignments.js';
import { vendorCrewMembers } from './vendor-crew-members.js';

export const VENDOR_CREW_ASSIGN_STATUSES = ['scheduled','confirmed','checked_in','checked_out','no_show','cancelled'] as const;
export type VendorCrewAssignStatus = (typeof VENDOR_CREW_ASSIGN_STATUSES)[number];

export const vendorCrewAssignments = pgTable(
  'vendor_crew_assignments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    vendorAssignmentId: uuid('vendor_assignment_id').notNull().references(() => vendorEventAssignments.id, { onDelete: 'cascade' }),
    crewMemberId: uuid('crew_member_id').notNull().references(() => vendorCrewMembers.id, { onDelete: 'cascade' }),
    vendorAccountId: uuid('vendor_account_id').notNull().references(() => vendorAccounts.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    roleOnEvent: text('role_on_event'),
    shiftStart: timestamp('shift_start', { withTimezone: true }),
    shiftEnd: timestamp('shift_end', { withTimezone: true }),
    hourlyRateOverride: numeric('hourly_rate_override', { precision: 10, scale: 2 }),
    status: text('status').$type<VendorCrewAssignStatus>().notNull().default('scheduled'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    uqAssignmentMember: uniqueIndex('uq_vendor_crew_assignments').on(t.vendorAssignmentId, t.crewMemberId),
    eventStatusIx: index('idx_vendor_crew_assign_status').on(t.eventId, t.status),
    statusEnum: check('vca_status_enum', sql`${t.status} IN ('scheduled','confirmed','checked_in','checked_out','no_show','cancelled')`),
  }),
);
export type VendorCrewAssignment = typeof vendorCrewAssignments.$inferSelect;
