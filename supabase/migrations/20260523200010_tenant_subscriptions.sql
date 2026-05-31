-- Phase 2 Unit 3: tenant_subscriptions (spec 3.2).
-- One subscription per tenant. billing_currency LOCKED at signup;
-- gateway_currency_locked must match (spec 3.14.1 belt-and-braces).

CREATE TABLE tenant_subscriptions (
  id                          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                     uuid          NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  price_override_amount       numeric(10,2) CHECK (price_override_amount IS NULL OR price_override_amount >= 0),
  price_override_currency     varchar(3)    CHECK (price_override_currency IS NULL OR price_override_currency ~ '^[A-Z]{3}$'),
  billing_currency            varchar(3)    NOT NULL CHECK (billing_currency ~ '^[A-Z]{3}$'),
  billing_cycle               text          NOT NULL CHECK (billing_cycle IN ('monthly','yearly')),
  status                      text          NOT NULL DEFAULT 'trial' CHECK (status IN
                                              ('trial','active','past_due','suspended','cancelled','paused')),
  trial_ends_at               timestamptz,
  trial_extended_by           uuid          REFERENCES super_admins(id) ON DELETE SET NULL,
  trial_extension_reason      text,
  current_period_start        timestamptz,
  current_period_end          timestamptz,
  paused_at                   timestamptz,
  pause_resume_at             timestamptz,
  pause_max_days_remaining    integer       CHECK (pause_max_days_remaining IS NULL OR pause_max_days_remaining >= 0),
  gateway                     text          CHECK (gateway IS NULL OR gateway IN ('razorpay','stripe','manual_invoice')),
  gateway_subscription_id     text,
  gateway_customer_id         text,
  gateway_currency_locked     varchar(3)    NOT NULL CHECK (gateway_currency_locked ~ '^[A-Z]{3}$'),
  po_number                   text,
  po_amount                   numeric(14,2) CHECK (po_amount IS NULL OR po_amount >= 0),
  po_expires_at               timestamptz,
  payment_terms_days          integer       NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  cancelled_at                timestamptz,
  cancellation_reason         text,
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id),
  CHECK (gateway_currency_locked = billing_currency),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CHECK (status <> 'paused' OR (paused_at IS NOT NULL AND pause_resume_at IS NOT NULL)),
  CHECK (status <> 'trial' OR trial_ends_at IS NOT NULL),
  CHECK (current_period_start IS NULL OR current_period_end IS NULL OR current_period_start < current_period_end)
);

CREATE INDEX idx_tenant_subscriptions_expiring ON tenant_subscriptions (trial_ends_at) WHERE status = 'trial';
CREATE INDEX idx_tenant_subscriptions_plan     ON tenant_subscriptions (plan_id);
CREATE INDEX idx_tenant_subscriptions_gw       ON tenant_subscriptions (gateway, gateway_subscription_id);
CREATE INDEX idx_tenant_subscriptions_paused   ON tenant_subscriptions (pause_resume_at) WHERE status = 'paused';
CREATE INDEX idx_tenant_subscriptions_extended_by ON tenant_subscriptions (trial_extended_by) WHERE trial_extended_by IS NOT NULL;

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
