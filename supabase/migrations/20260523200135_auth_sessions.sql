-- Phase 2 Unit 28: auth_sessions (spec 19).
-- JWT refresh-session tracker. Multi-portal: tenant_member / super_admin /
-- client / vendor / guest / speaker. refresh_token_hash = sha256 of refresh
-- token; active sessions are globally unique on it; revoked rows stay for
-- rotation history. super_admin sessions may have NULL tenant_id.

CREATE TABLE auth_sessions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL,
  user_type          text        NOT NULL CHECK (user_type IN ('tenant_member','super_admin','client','vendor','guest','speaker')),
  tenant_id          uuid        REFERENCES tenants (id) ON DELETE CASCADE,
  portal             text        NOT NULL CHECK (portal IN ('admin','tenant','client','vendor','guest','speaker','super_admin')),
  refresh_token_hash text        NOT NULL CHECK (length(refresh_token_hash) = 64),
  device_fingerprint text        CHECK (device_fingerprint IS NULL OR length(trim(device_fingerprint)) BETWEEN 8 AND 256),
  device_name        text        CHECK (device_name IS NULL OR length(trim(device_name)) BETWEEN 1 AND 120),
  device_type        text        CHECK (device_type IS NULL OR device_type IN ('desktop','mobile','tablet','other')),
  os                 text        CHECK (os IS NULL OR length(trim(os)) BETWEEN 1 AND 80),
  browser            text        CHECK (browser IS NULL OR length(trim(browser)) BETWEEN 1 AND 80),
  ip_address         inet,
  ip_country         varchar(2)  CHECK (ip_country IS NULL OR ip_country ~ '^[A-Z]{2}$'),
  user_agent         text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoke_reason      text        CHECK (revoke_reason IS NULL OR revoke_reason IN ('user_logout','admin_revoke','concurrent_limit','suspicious','password_change','refresh_rotation','mfa_revoke')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (user_type = 'super_admin' OR tenant_id IS NOT NULL),
  CHECK (expires_at > created_at),
  CHECK (last_seen_at >= created_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE UNIQUE INDEX uq_auth_sessions_token_active
  ON auth_sessions (refresh_token_hash) WHERE revoked_at IS NULL;

CREATE INDEX idx_auth_sessions_user        ON auth_sessions (user_id, user_type, revoked_at);
CREATE INDEX idx_auth_sessions_token_hash  ON auth_sessions (refresh_token_hash);
CREATE INDEX idx_auth_sessions_fingerprint ON auth_sessions (device_fingerprint) WHERE device_fingerprint IS NOT NULL;
CREATE INDEX idx_auth_sessions_tenant      ON auth_sessions (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_auth_sessions_active_exp  ON auth_sessions (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_auth_sessions_portal      ON auth_sessions (portal, user_id) WHERE revoked_at IS NULL;

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
