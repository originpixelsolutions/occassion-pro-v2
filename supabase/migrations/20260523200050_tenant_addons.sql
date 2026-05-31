-- Phase 2 Unit 11: tenant_addons (spec 3.13).
-- Per-tenant capacity / feature add-on subscriptions. Partial unique
-- blocks two simultaneous active subs of the same pack per tenant;
-- quantity carries scale within a single sub.

CREATE TABLE tenant_addons (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  addon_id             uuid        NOT NULL REFERENCES addons_catalog (id) ON DELETE RESTRICT,
  quantity             integer     NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 1000),
  status               text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','past_due')),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_ta_active_per_tenant_addon
  ON tenant_addons (tenant_id, addon_id)
  WHERE status = 'active';

CREATE INDEX idx_ta_tenant_active ON tenant_addons (tenant_id) WHERE status = 'active';
CREATE INDEX idx_ta_addon         ON tenant_addons (addon_id);
CREATE INDEX idx_ta_period_end    ON tenant_addons (current_period_end) WHERE status = 'active';

ALTER TABLE tenant_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_addons FORCE ROW LEVEL SECURITY;
