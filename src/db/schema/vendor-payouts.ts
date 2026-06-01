import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
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
import { vendorEventAssignments } from './vendor-event-assignments.js';

export const PAYOUT_STATUSES = [
  'scheduled',
  'approved',
  'disbursing',
  'disbursed',
  'failed',
  'cancelled',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_GATEWAYS = [
  'razorpay_x',
  'stripe_connect',
  'cashfree_payout',
  'manual',
  'bank_transfer',
  'cheque',
] as const;
export type PayoutGateway = (typeof PAYOUT_GATEWAYS)[number];

export const PAYOUT_MILESTONE_TYPES = [
  'booking_advance',
  'progress',
  'final',
  'retainer',
  'expense_reimbursement',
  'bonus',
  'other',
] as const;
export type PayoutMilestoneType = (typeof PAYOUT_MILESTONE_TYPES)[number];

export const vendorPayouts = pgTable(
  'vendor_payouts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    vendorAccountId: uuid('vendor_account_id').references(() => vendorAccounts.id, {
      onDelete: 'set null',
    }),
    assignmentId: uuid('assignment_id').references(() => vendorEventAssignments.id, {
      onDelete: 'set null',
    }),
    milestone: text('milestone').notNull(),
    milestoneType: text('milestone_type').$type<PayoutMilestoneType>(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    fees: numeric('fees', { precision: 14, scale: 2 }),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    status: text('status').$type<PayoutStatus>().notNull().default('scheduled'),
    gateway: text('gateway').$type<PayoutGateway>(),
    gatewayPayoutId: text('gateway_payout_id'),
    gatewayUtr: text('gateway_utr'),
    bankAccountLast4: text('bank_account_last4'),
    ifscCode: text('ifsc_code'),
    approvedBy: uuid('approved_by').references(() => tenantMembers.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    disbursedAt: timestamp('disbursed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    notes: text('notes'),
    metadata: jsonb('metadata'),
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
    gatewayUq: uniqueIndex('uq_vendor_payouts_gateway')
      .on(t.gateway, t.gatewayPayoutId)
      .where(sql`${t.gatewayPayoutId} IS NOT NULL`),
    statusScheduledIx: index('idx_payouts_status_scheduled')
      .on(t.status, t.scheduledFor)
      .where(sql`${t.status} IN ('scheduled','approved') AND ${t.deletedAt} IS NULL`),
    statusEnum: check(
      'vp_status_enum',
      sql`${t.status} IN ('scheduled','approved','disbursing','disbursed','failed','cancelled')`,
    ),
    amountPositive: check('vp_amount_positive', sql`${t.amount} > 0`),
  }),
);
export type VendorPayout = typeof vendorPayouts.$inferSelect;
