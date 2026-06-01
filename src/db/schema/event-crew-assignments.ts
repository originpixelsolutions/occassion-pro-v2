import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { crewPool } from './crew-pool.js';
import { tenantMembers } from './tenant-members.js';

export const CREW_ASSIGN_STATUSES = [
  'scheduled', 'confirmed', 'checked_in', 'checked_out', 'no_show', 'cancelled',
] as const;
export type CrewAssignStatus = (typeof CREW_ASSIGN_STATUSES)[number];

export const CREW_PAYMENT_METHODS = [
  'cash','upi','bank_transfer','razorpay_x','stripe','other',
] as const;
export type CrewPaymentMethod = (typeof CREW_PAYMENT_METHODS)[number];

export const eventCrewAssignments = pgTable(
  'event_crew_assignments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    crewId: uuid('crew_id').notNull().references(() => crewPool.id, { onDelete: 'cascade' }),
    roleOnEvent: text('role_on_event'),
    shiftStart: timestamp('shift_start', { withTimezone: true }).notNull(),
    shiftEnd: timestamp('shift_end', { withTimezone: true }).notNull(),
    hourlyRateOverride: numeric('hourly_rate_override', { precision: 10, scale: 2 }),
    hoursWorked: numeric('hours_worked', { precision: 5, scale: 2 }),
    status: text('status').$type<CrewAssignStatus>().notNull().default('scheduled'),
    checkInAt: timestamp('check_in_at', { withTimezone: true }),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    totalPayable: numeric('total_payable', { precision: 14, scale: 2 }),
    currencyCode: varchar('currency_code', { length: 3 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentMethod: text('payment_method').$type<CrewPaymentMethod>(),
    paymentReference: text('payment_reference'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    notes: text('notes'),
    assignedBy: uuid('assigned_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    statusEnum: check(
      'eca_status',
      sql`${t.status} IN ('scheduled','confirmed','checked_in','checked_out','no_show','cancelled')`,
    ),
    shiftOrder: check('eca_shift_order', sql`${t.shiftEnd} > ${t.shiftStart}`),
    hoursBounds: check(
      'eca_hours_bounds',
      sql`${t.hoursWorked} IS NULL OR (${t.hoursWorked} >= 0 AND ${t.hoursWorked} <= 168)`,
    ),
    paymentCoupling: check(
      'eca_payment_coupling',
      sql`(${t.paidAt} IS NULL AND ${t.paymentMethod} IS NULL)
       OR (${t.paidAt} IS NOT NULL AND ${t.paymentMethod} IS NOT NULL AND ${t.totalPayable} IS NOT NULL AND ${t.currencyCode} IS NOT NULL)`,
    ),
    eventIdx: index('idx_crew_assign_event').on(t.eventId),
  }),
);
export type EventCrewAssignment = typeof eventCrewAssignments.$inferSelect;
