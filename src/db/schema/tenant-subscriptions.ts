import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
  integer,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { subscriptionPlans } from './subscription-plans.js';
import { superAdmins } from './super-admins.js';

export const SUBSCRIPTION_STATUSES = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'paused',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_GATEWAYS = ['razorpay', 'stripe', 'manual_invoice'] as const;
export type BillingGateway = (typeof BILLING_GATEWAYS)[number];

export const tenantSubscriptions = pgTable(
  'tenant_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
    priceOverrideAmount: numeric('price_override_amount', { precision: 10, scale: 2 }),
    priceOverrideCurrency: varchar('price_override_currency', { length: 3 }),
    billingCurrency: varchar('billing_currency', { length: 3 }).notNull(),
    billingCycle: text('billing_cycle').notNull(),
    status: text('status').$type<SubscriptionStatus>().notNull().default('trial'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    trialExtendedBy: uuid('trial_extended_by').references(() => superAdmins.id, {
      onDelete: 'set null',
    }),
    trialExtensionReason: text('trial_extension_reason'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pauseResumeAt: timestamp('pause_resume_at', { withTimezone: true }),
    pauseMaxDaysRemaining: integer('pause_max_days_remaining'),
    gateway: text('gateway').$type<BillingGateway>(),
    gatewaySubscriptionId: text('gateway_subscription_id'),
    gatewayCustomerId: text('gateway_customer_id'),
    gatewayCurrencyLocked: varchar('gateway_currency_locked', { length: 3 }).notNull(),
    poNumber: text('po_number'),
    poAmount: numeric('po_amount', { precision: 14, scale: 2 }),
    poExpiresAt: timestamp('po_expires_at', { withTimezone: true }),
    paymentTermsDays: integer('payment_terms_days').notNull().default(0),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tenantUq: unique('tenant_subscriptions_tenant_id_key').on(t.tenantId),
    cycleEnum: check('tenant_subscriptions_cycle', sql`${t.billingCycle} IN ('monthly','yearly')`),
    statusEnum: check(
      'tenant_subscriptions_status',
      sql`${t.status} IN ('trial','active','past_due','suspended','cancelled','paused')`,
    ),
    currencyMatch: check(
      'tenant_subscriptions_currency_lock',
      sql`${t.gatewayCurrencyLocked} = ${t.billingCurrency}`,
    ),
    expiringIdx: index('idx_tenant_subscriptions_expiring')
      .on(t.trialEndsAt)
      .where(sql`${t.status} = 'trial'`),
    planIdx: index('idx_tenant_subscriptions_plan').on(t.planId),
  }),
);
export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
