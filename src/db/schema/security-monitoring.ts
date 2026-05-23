import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  integer,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const BRAND_ALERT_STATUSES = [
  'new',
  'investigating',
  'confirmed_malicious',
  'false_positive',
  'taken_down',
] as const;
export type BrandAlertStatus = (typeof BRAND_ALERT_STATUSES)[number];

export const brandImpersonationAlerts = pgTable(
  'brand_impersonation_alerts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    detectedDomain: text('detected_domain').notNull(),
    similarityScore: numeric('similarity_score', { precision: 3, scale: 2 }),
    detectedVia: text('detected_via').notNull(),
    status: text('status').$type<BrandAlertStatus>().notNull().default('new'),
    takedownFiledAt: timestamp('takedown_filed_at', { withTimezone: true }),
    takedownProvider: text('takedown_provider'),
    takenDownAt: timestamp('taken_down_at', { withTimezone: true }),
    notes: text('notes'),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    statusIdx: index('idx_brand_impersonation_status').on(t.status),
    detectedAtIdx: index('idx_brand_impersonation_detected_at').on(t.detectedAt),
  }),
);
export type BrandImpersonationAlert = typeof brandImpersonationAlerts.$inferSelect;

export const SUB_PROCESSOR_STATUSES = ['investigating', 'contained', 'resolved'] as const;
export type SubProcessorStatus = (typeof SUB_PROCESSOR_STATUSES)[number];

export const subProcessorIncidents = pgTable(
  'sub_processor_incidents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    subProcessor: text('sub_processor').notNull(),
    incidentDate: date('incident_date').notNull(),
    disclosedAt: timestamp('disclosed_at', { withTimezone: true }).notNull(),
    affectedData: text('affected_data')
      .array()
      .notNull()
      .default(sql`'{}'`),
    affectedPeriodStart: timestamp('affected_period_start', { withTimezone: true }),
    affectedPeriodEnd: timestamp('affected_period_end', { withTimezone: true }),
    estimatedTenantsAffected: integer('estimated_tenants_affected'),
    remediationActions: jsonb('remediation_actions'),
    customerNotificationSentAt: timestamp('customer_notification_sent_at', { withTimezone: true }),
    regulatorNotificationSentAt: timestamp('regulator_notification_sent_at', {
      withTimezone: true,
    }),
    status: text('status').$type<SubProcessorStatus>().notNull().default('investigating'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    statusIdx: index('idx_sub_processor_incidents_status').on(t.status),
    dateIdx: index('idx_sub_processor_incidents_date').on(t.incidentDate),
  }),
);
export type SubProcessorIncident = typeof subProcessorIncidents.$inferSelect;
