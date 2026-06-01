-- Phase 2 Unit 39: tenant_health_scores (spec 32.1).
-- Per-tenant churn-risk health scores. PK = tenant_id (singleton).
-- Weighted formula in worker:
--   0.3 * product + 0.2 * team + 0.25 * financial + 0.15 * support + 0.1 * growth
-- Risk levels: low >= 70, medium 50-69, high 30-49, critical < 30 OR 30d-no-login.

CREATE TABLE tenant_health_scores (
  tenant_id                uuid          PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  overall_score            numeric(5,2)  CHECK (overall_score            IS NULL OR overall_score            BETWEEN 0 AND 100),
  product_engagement_score numeric(5,2)  CHECK (product_engagement_score IS NULL OR product_engagement_score BETWEEN 0 AND 100),
  team_engagement_score    numeric(5,2)  CHECK (team_engagement_score    IS NULL OR team_engagement_score    BETWEEN 0 AND 100),
  financial_health_score   numeric(5,2)  CHECK (financial_health_score   IS NULL OR financial_health_score   BETWEEN 0 AND 100),
  support_health_score     numeric(5,2)  CHECK (support_health_score     IS NULL OR support_health_score     BETWEEN 0 AND 100),
  growth_score             numeric(5,2)  CHECK (growth_score             IS NULL OR growth_score             BETWEEN 0 AND 100),
  churn_risk_level         text          CHECK (churn_risk_level IS NULL OR churn_risk_level IN ('low','medium','high','critical')),
  churn_risk_reasons       text[]        CHECK (churn_risk_reasons IS NULL OR cardinality(churn_risk_reasons) BETWEEN 1 AND 20),
  last_login_at            timestamptz,
  days_since_last_event    integer       CHECK (days_since_last_event IS NULL OR days_since_last_event >= 0),
  ticket_count_30d         integer       CHECK (ticket_count_30d      IS NULL OR ticket_count_30d      >= 0),
  failed_payment_count     integer       CHECK (failed_payment_count  IS NULL OR failed_payment_count  >= 0),
  trial_extension_count    integer       CHECK (trial_extension_count IS NULL OR trial_extension_count >= 0),
  computed_at              timestamptz   NOT NULL DEFAULT now(),
  CHECK ((overall_score IS NULL) = (churn_risk_level IS NULL))
);

CREATE INDEX idx_tenant_health_risk     ON tenant_health_scores (churn_risk_level, overall_score);
CREATE INDEX idx_tenant_health_computed ON tenant_health_scores (computed_at);
CREATE INDEX idx_tenant_health_critical ON tenant_health_scores (tenant_id) WHERE churn_risk_level = 'critical';

ALTER TABLE tenant_health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_health_scores FORCE ROW LEVEL SECURITY;
