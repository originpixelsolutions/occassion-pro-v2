-- Phase 2 Unit 37: subscription_pauses (spec 3.14.8).
-- Annual-plan seasonal pause. DB enforces:
--   - 7-day minimum
--   - 120-day Enterprise-tier max-continuous ceiling
-- Per-plan caps (Growth 30, Pro 60) and per-year aggregates (Growth 60,
-- Pro 90, Enterprise 180) are enforced at the app layer because they
-- depend on tenant_subscriptions.plan_id.

CREATE TABLE subscription_pauses (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  paused_at              timestamptz NOT NULL DEFAULT now(),
  pause_resume_at        timestamptz NOT NULL,
  reason                 text        CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 2000),
  initiated_by           uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  resumed_at             timestamptz,
  resumed_by             uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  cancelled_during_pause boolean     NOT NULL DEFAULT FALSE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (pause_resume_at >= paused_at + INTERVAL '7 days'),
  CHECK (pause_resume_at <= paused_at + INTERVAL '120 days'),
  CHECK (resumed_at IS NULL OR resumed_at >= paused_at)
);

CREATE INDEX idx_subscription_pauses_resume    ON subscription_pauses (pause_resume_at) WHERE resumed_at IS NULL;
CREATE INDEX idx_subscription_pauses_tenant    ON subscription_pauses (tenant_id, created_at DESC);
CREATE INDEX idx_subscription_pauses_initiator ON subscription_pauses (initiated_by) WHERE initiated_by IS NOT NULL;

CREATE UNIQUE INDEX uq_subscription_pauses_open
  ON subscription_pauses (tenant_id) WHERE resumed_at IS NULL;

ALTER TABLE subscription_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_pauses FORCE ROW LEVEL SECURITY;
