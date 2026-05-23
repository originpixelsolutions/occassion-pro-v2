import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';

export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    code: text('code').unique().notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    maxActiveEvents: integer('max_active_events'),
    maxUsers: integer('max_users'),
    maxStorageGb: integer('max_storage_gb'),
    maxGuestsPerEvent: integer('max_guests_per_event'),
    maxConcurrentSessions: integer('max_concurrent_sessions').notNull().default(5),
    maxEmailsPerMonth: integer('max_emails_per_month'),
    maxApiRequestsPerMonth: integer('max_api_requests_per_month'),
    maxOutgoingWebhooks: integer('max_outgoing_webhooks'),
    maxCustomEventTypes: integer('max_custom_event_types'),
    auditLogRetentionDays: integer('audit_log_retention_days'),
    trialPoolSmsPerMonth: integer('trial_pool_sms_per_month'),
    includesConferenceModule: boolean('includes_conference_module').notNull().default(false),
    includesBrandedExports: boolean('includes_branded_exports').notNull().default(false),
    includesMultiCurrency: boolean('includes_multi_currency').notNull().default(false),
    includesCrossEventAnalytics: boolean('includes_cross_event_analytics').notNull().default(false),
    includesWhiteLabel: boolean('includes_white_label').notNull().default(false),
    includesCustomDomain: boolean('includes_custom_domain').notNull().default(false),
    includesAiVendorRecommender: boolean('includes_ai_vendor_recommender').notNull().default(false),
    includesAiCommandCenter: boolean('includes_ai_command_center').notNull().default(false),
    includesVendorPayouts: boolean('includes_vendor_payouts').notNull().default(false),
    includesByoEmail: boolean('includes_byo_email').notNull().default(false),
    includesSso: boolean('includes_sso').notNull().default(false),
    includesApiFull: boolean('includes_api_full').notNull().default(false),
    includesCloudOffload: boolean('includes_cloud_offload').notNull().default(false),
    includesEsignature: boolean('includes_esignature').notNull().default(false),
    includesPoBilling: boolean('includes_po_billing').notNull().default(false),
    includesNet30Terms: boolean('includes_net30_terms').notNull().default(false),
    slaUptimePercent: numeric('sla_uptime_percent', { precision: 5, scale: 2 }),
    priceInrMonthly: numeric('price_inr_monthly', { precision: 10, scale: 2 }),
    priceInrYearly: numeric('price_inr_yearly', { precision: 10, scale: 2 }),
    priceUsdMonthly: numeric('price_usd_monthly', { precision: 10, scale: 2 }),
    priceUsdYearly: numeric('price_usd_yearly', { precision: 10, scale: 2 }),
    setupFeeInr: numeric('setup_fee_inr', { precision: 10, scale: 2 }).notNull().default('0'),
    setupFeeUsd: numeric('setup_fee_usd', { precision: 10, scale: 2 }).notNull().default('0'),
    trialDays: integer('trial_days').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check('subscription_plans_status', sql`${t.status} IN ('active','archived')`),
    statusIdx: index('idx_subscription_plans_status')
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
  }),
);
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
