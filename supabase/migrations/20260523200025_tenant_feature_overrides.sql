-- Phase 2 Unit 6: tenant_feature_overrides (spec 3.6).
-- Per-tenant feature flag overrides. Composite PK (tenant_id, flag_code).
-- Precedence: tenant override > plan flag > feature default.

CREATE TABLE tenant_feature_overrides (
  tenant_id    uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  flag_code    text        NOT NULL REFERENCES feature_flags (code) ON DELETE CASCADE,
  enabled      boolean     NOT NULL,
  reason       text        CHECK (reason IS NULL OR length(reason) <= 500),
  set_by_admin uuid        REFERENCES super_admins (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, flag_code)
);

CREATE INDEX idx_tfo_flag_code    ON tenant_feature_overrides (flag_code);
CREATE INDEX idx_tfo_set_by_admin ON tenant_feature_overrides (set_by_admin) WHERE set_by_admin IS NOT NULL;
CREATE INDEX idx_tfo_enabled      ON tenant_feature_overrides (tenant_id, enabled);

ALTER TABLE tenant_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_overrides FORCE ROW LEVEL SECURITY;
