-- Phase 2 Unit 12: tenant_payment_methods (spec 3.14.2).
-- Saved payment methods per tenant. Soft-delete via removed_at;
-- primary/backup mutually exclusive; one active of each per tenant.

CREATE TABLE tenant_payment_methods (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  gateway                   text        NOT NULL CHECK (gateway IN ('razorpay','stripe')),
  gateway_payment_method_id text        NOT NULL CHECK (length(trim(gateway_payment_method_id)) > 0),
  last4                     text        CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  brand                     text        CHECK (brand IS NULL OR brand IN ('visa','mastercard','amex','rupay','discover','diners','jcb','unionpay','other')),
  exp_month                 integer     CHECK (exp_month IS NULL OR exp_month BETWEEN 1 AND 12),
  exp_year                  integer     CHECK (exp_year  IS NULL OR exp_year  BETWEEN 2024 AND 2099),
  is_primary                boolean     NOT NULL DEFAULT FALSE,
  is_backup                 boolean     NOT NULL DEFAULT FALSE,
  added_by                  uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  removed_at                timestamptz,
  CHECK (NOT (is_primary AND is_backup)),
  CHECK ((exp_month IS NULL) = (exp_year IS NULL))
);

CREATE INDEX idx_payment_methods_tenant ON tenant_payment_methods (tenant_id) WHERE removed_at IS NULL;
CREATE INDEX idx_payment_methods_added_by ON tenant_payment_methods (added_by) WHERE added_by IS NOT NULL;

CREATE UNIQUE INDEX one_primary_card_per_tenant
  ON tenant_payment_methods (tenant_id) WHERE is_primary AND removed_at IS NULL;
CREATE UNIQUE INDEX one_backup_card_per_tenant
  ON tenant_payment_methods (tenant_id) WHERE is_backup  AND removed_at IS NULL;

CREATE UNIQUE INDEX uq_payment_methods_gateway_token
  ON tenant_payment_methods (gateway, gateway_payment_method_id)
  WHERE removed_at IS NULL;

ALTER TABLE tenant_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_payment_methods FORCE ROW LEVEL SECURITY;
