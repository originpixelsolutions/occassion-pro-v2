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
import { citext } from '../columns.js';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { tenantMembers } from './tenant-members.js';
import { invoices } from './invoices.js';

export const PAYER_TYPES = [
  'client',
  'guest',
  'sponsor',
  'exhibitor',
  'tenant_subscription',
  'other',
] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
  'cancelled',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_GATEWAYS_V2 = [
  'razorpay',
  'stripe',
  'cashfree',
  'paytm',
  'manual',
  'bank_transfer',
  'cheque',
  'cash',
  'other',
] as const;
export type PaymentGatewayV2 = (typeof PAYMENT_GATEWAYS_V2)[number];

export const PAYMENT_METHODS = [
  'card',
  'upi',
  'netbanking',
  'wallet',
  'emi',
  'paylater',
  'bank_transfer',
  'cheque',
  'cash',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    payerType: text('payer_type').$type<PayerType>().notNull(),
    payerId: uuid('payer_id'),
    payerName: text('payer_name'),
    payerEmail: citext('payer_email'),
    payerPhone: text('payer_phone'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    status: text('status').$type<PaymentStatus>().notNull().default('pending'),
    gateway: text('gateway').$type<PaymentGatewayV2>().notNull(),
    gatewayPaymentId: text('gateway_payment_id'),
    gatewayOrderId: text('gateway_order_id'),
    gatewaySignature: text('gateway_signature'),
    paymentMethod: text('payment_method').$type<PaymentMethod>(),
    refundedAmount: numeric('refunded_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    fees: numeric('fees', { precision: 14, scale: 2 }),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    refundReason: text('refund_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    metadata: jsonb('metadata'),
    ipAddress: text('ip_address'),
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
    gatewayPaymentUq: uniqueIndex('uq_payments_gateway_payment')
      .on(t.gateway, t.gatewayPaymentId)
      .where(sql`${t.gatewayPaymentId} IS NOT NULL`),
    statusIx: index('idx_payments_status_time')
      .on(t.tenantId, t.status, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    payerEnum: check(
      'pay_payer_enum',
      sql`${t.payerType} IN ('client','guest','sponsor','exhibitor','tenant_subscription','other')`,
    ),
    statusEnum: check(
      'pay_status_enum',
      sql`${t.status} IN ('pending','authorized','succeeded','failed','refunded','partially_refunded','cancelled')`,
    ),
    gatewayEnum: check(
      'pay_gateway_enum',
      sql`${t.gateway} IN ('razorpay','stripe','cashfree','paytm','manual','bank_transfer','cheque','cash','other')`,
    ),
    amountPositive: check('pay_amount_positive', sql`${t.amount} > 0`),
    refundLeAmount: check('pay_refund_le_amount', sql`${t.refundedAmount} <= ${t.amount}`),
  }),
);
export type Payment = typeof payments.$inferSelect;
