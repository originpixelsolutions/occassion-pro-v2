import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
} from 'drizzle-orm/pg-core';

export const tenantCohortMetrics = pgTable(
  'tenant_cohort_metrics',
  {
    cohortMonth: date('cohort_month').notNull(),
    measurementMonth: date('measurement_month').notNull(),
    tenantsSignedUp: integer('tenants_signed_up').notNull().default(0),
    tenantsConverted: integer('tenants_converted').notNull().default(0),
    tenantsStillActive: integer('tenants_still_active').notNull().default(0),
    tenantsChurned: integer('tenants_churned').notNull().default(0),
    totalMrr: numeric('total_mrr', { precision: 14, scale: 2 }).notNull().default('0'),
    totalArr: numeric('total_arr', { precision: 14, scale: 2 }).notNull().default('0'),
    netRevenueRetention: numeric('net_revenue_retention', { precision: 5, scale: 2 }),
    grossRevenueRetention: numeric('gross_revenue_retention', { precision: 5, scale: 2 }),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.cohortMonth, t.measurementMonth] }),
    cohortFirstOfMonth: check(
      'tcm_cohort_first_of_month',
      sql`${t.cohortMonth} = date_trunc('month', ${t.cohortMonth})::date`,
    ),
    measurementFirstOfMonth: check(
      'tcm_measurement_first_of_month',
      sql`${t.measurementMonth} = date_trunc('month', ${t.measurementMonth})::date`,
    ),
    measurementAfterCohort: check(
      'tcm_measurement_after_cohort',
      sql`${t.measurementMonth} >= ${t.cohortMonth}`,
    ),
    convertedUnderSigned: check(
      'tcm_converted_under_signed',
      sql`${t.tenantsConverted} <= ${t.tenantsSignedUp}`,
    ),
    activeChurnedUnderConverted: check(
      'tcm_active_churned_under_converted',
      sql`${t.tenantsStillActive} + ${t.tenantsChurned} <= ${t.tenantsConverted}`,
    ),
    nrrBounds: check(
      'tcm_nrr_bounds',
      sql`${t.netRevenueRetention} IS NULL OR ${t.netRevenueRetention} BETWEEN 0 AND 200`,
    ),
    grrBounds: check(
      'tcm_grr_bounds',
      sql`${t.grossRevenueRetention} IS NULL OR ${t.grossRevenueRetention} BETWEEN 0 AND 100`,
    ),
    measurementIdx: index('idx_cohort_metrics_measurement').on(t.measurementMonth),
  }),
);
export type TenantCohortMetric = typeof tenantCohortMetrics.$inferSelect;
