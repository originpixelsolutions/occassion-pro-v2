-- Phase 2 Unit 7: tenant_api_keys (spec 3.10).
-- Tenant-scoped API keys with prefix + sha256 hash, scopes, optional
-- last-used tracking, default 365-day expiry, soft-revoke via revoked_at.

CREATE TABLE tenant_api_keys (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name         text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  key_prefix   text        NOT NULL CHECK (key_prefix ~ '^op_(live|test)_[A-Za-z0-9]{8}$'),
  key_hash     text        NOT NULL CHECK (length(key_hash) = 64),
  scopes       text[]      NOT NULL CHECK (cardinality(scopes) >= 1),
  created_by   uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  last_used_at timestamptz,
  last_used_ip inet,
  revoked_at   timestamptz,
  expires_at   timestamptz NOT NULL DEFAULT (now() + INTERVAL '365 days'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX idx_api_key_hash    ON tenant_api_keys (key_hash);
CREATE INDEX idx_api_key_tenant         ON tenant_api_keys (tenant_id);
CREATE INDEX idx_api_key_created_by     ON tenant_api_keys (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_api_key_active_expiry  ON tenant_api_keys (expires_at) WHERE revoked_at IS NULL;

ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_api_keys FORCE ROW LEVEL SECURITY;
