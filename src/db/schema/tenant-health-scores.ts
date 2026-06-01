import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const CHURN_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type ChurnRiskLevel = (typeof CHURN_RISK_LEVELS)[number];

export const tenantHealthScores = pgTable(
  'tenant_health_scores',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    overallScore: numeric('overall_score', { precision: 5, scale: 2 }),
    productEngagementScore: numeric('product_engagement_score', { precision: 5, scale: 2 }),
    teamEngagementScore: numeric('team_engagement_score', { precision: 5, scale: 2 }),
    financialHealthScore: numeric('financial_health_score', { precision: 5, scale: 2 }),
    supportHealthScore: numeric('support_health_score', { precision: 5, scale: 2 }),
    growthScore: numeric('growth_score', { precision: 5, scale: 2 }),
    churnRiskLevel: text('churn_risk_level').$type<ChurnRiskLevel>(),
    churnRiskReasons: text('churn_risk_reasons').array(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    daysSinceLastEvent: integer('days_since_last_event'),
    ticketCount30d: integer('ticket_count_30d'),
    failedPaymentCount: integer('failed_payment_count'),
    trialExtensionCount: integer('trial_extension_count'),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    riskEnum: check(
      'ths_risk',
      sql`${t.churnRiskLevel} IS NULL OR ${t.churnRiskLevel} IN ('low','medium','high','critical')`,
    ),
    overallBounds: check(
      'ths_overall_bounds',
      sql`${t.overallScore} IS NULL OR ${t.overallScore} BETWEEN 0 AND 100`,
    ),
    overallRiskCoupling: check(
      'ths_overall_risk_coupling',
      sql`(${t.overallScore} IS NULL) = (${t.churnRiskLevel} IS NULL)`,
    ),
    riskIdx: index('idx_tenant_health_risk').on(t.churnRiskLevel, t.overallScore),
  }),
);
export type TenantHealthScore = typeof tenantHealthScores.$inferSelect;
