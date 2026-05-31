-- Phase 2 Unit 10: tenant_storage_addons (spec 3.12).
-- Per-tenant storage upsell subscriptions. 30-day re-cancel cooldown
-- prevents churn-dance; partial unique blocks two simultaneous active
-- subs of the same pack.

CREATE TABLE tenant_storage_addons (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  addon_id                    uuid        NOT NULL REFERENCES storage_addons_catalog (id) ON DELETE RESTRICT,
  quantity                    integer     NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 100),
  status                      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','past_due')),
  current_period_start        timestamptz,
  current_period_end          timestamptz,
  cancelled_at                timestamptz,
  cancellation_cooldown_until timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CHECK (cancellation_cooldown_until IS NULL OR cancellation_cooldown_until > cancelled_at)
);

CREATE UNIQUE INDEX uq_tsa_active_per_tenant_addon
  ON tenant_storage_addons (tenant_id, addon_id)
  WHERE status = 'active';

CREATE INDEX idx_tsa_tenant_active ON tenant_storage_addons (tenant_id) WHERE status = 'active';
CREATE INDEX idx_tsa_addon         ON tenant_storage_addons (addon_id);
CREATE INDEX idx_tsa_period_end    ON tenant_storage_addons (current_period_end) WHERE status = 'active';
CREATE INDEX idx_tsa_cooldown      ON tenant_storage_addons (tenant_id, cancellation_cooldown_until) WHERE cancellation_cooldown_until IS NOT NULL;

ALTER TABLE tenant_storage_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_storage_addons FORCE ROW LEVEL SECURITY;
