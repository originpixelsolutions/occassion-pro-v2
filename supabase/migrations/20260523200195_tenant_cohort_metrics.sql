-- Phase 2 Unit 40: tenant_cohort_metrics (spec 32.2).
-- Cohort x measurement month MRR/ARR retention grid. NRR allowed >100%
-- to capture expansion; GRR capped at 100. Dates pinned to first-of-month.

CREATE TABLE tenant_cohort_metrics (
  cohort_month            date          NOT NULL,
  measurement_month       date          NOT NULL,
  tenants_signed_up       integer       NOT NULL DEFAULT 0 CHECK (tenants_signed_up    >= 0),
  tenants_converted       integer       NOT NULL DEFAULT 0 CHECK (tenants_converted    >= 0),
  tenants_still_active    integer       NOT NULL DEFAULT 0 CHECK (tenants_still_active >= 0),
  tenants_churned         integer       NOT NULL DEFAULT 0 CHECK (tenants_churned      >= 0),
  total_mrr               numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_mrr  >= 0),
  total_arr               numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_arr  >= 0),
  net_revenue_retention   numeric(5,2)  CHECK (net_revenue_retention   IS NULL OR net_revenue_retention   BETWEEN 0 AND 200),
  gross_revenue_retention numeric(5,2)  CHECK (gross_revenue_retention IS NULL OR gross_revenue_retention BETWEEN 0 AND 100),
  computed_at             timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_month, measurement_month),
  CHECK (cohort_month      = date_trunc('month', cohort_month)::date),
  CHECK (measurement_month = date_trunc('month', measurement_month)::date),
  CHECK (measurement_month >= cohort_month),
  CHECK (tenants_converted <= tenants_signed_up),
  CHECK (tenants_still_active + tenants_churned <= tenants_converted)
);

CREATE INDEX idx_cohort_metrics_cohort      ON tenant_cohort_metrics (cohort_month);
CREATE INDEX idx_cohort_metrics_measurement ON tenant_cohort_metrics (measurement_month);
CREATE INDEX idx_cohort_metrics_recent      ON tenant_cohort_metrics (measurement_month DESC, cohort_month);

ALTER TABLE tenant_cohort_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_cohort_metrics FORCE ROW LEVEL SECURITY;
