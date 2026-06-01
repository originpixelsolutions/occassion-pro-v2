-- Phase 2 Unit 43: oauth_access_tokens (spec 31.7, RFC 6749).
-- Access + refresh tokens. Hashes only, never plaintext. Access TTL <= 24h,
-- refresh TTL <= 365d. Partial UNIQUE on (access|refresh)_token_hash
-- WHERE NOT revoked lets rotation history pile up while blocking two LIVE
-- tokens with the same hash.

CREATE TABLE oauth_access_tokens (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  oauth_app_id             uuid        NOT NULL REFERENCES tenant_oauth_apps (id) ON DELETE CASCADE,
  authorization_code_id    uuid        REFERENCES oauth_authorization_codes (id) ON DELETE SET NULL,
  access_token_hash        text        NOT NULL CHECK (length(access_token_hash) = 64),
  refresh_token_hash       text        CHECK (refresh_token_hash IS NULL OR length(refresh_token_hash) = 64),
  user_id                  uuid        NOT NULL,
  user_type                text        NOT NULL CHECK (user_type IN ('tenant_member','super_admin','client','vendor','speaker')),
  tenant_id                uuid        REFERENCES tenants (id) ON DELETE CASCADE,
  scopes                   text[]      NOT NULL CHECK (cardinality(scopes) >= 1),
  token_type               text        NOT NULL DEFAULT 'Bearer' CHECK (token_type IN ('Bearer')),
  expires_at               timestamptz NOT NULL,
  refresh_expires_at       timestamptz,
  last_used_at             timestamptz,
  last_used_ip             inet,
  revoked_at               timestamptz,
  revoke_reason            text        CHECK (revoke_reason IS NULL OR revoke_reason IN ('user_revoke','admin_revoke','rotation','expired','suspicious','app_revoke')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + INTERVAL '24 hours'),
  CHECK (refresh_expires_at IS NULL OR refresh_expires_at > expires_at),
  CHECK (refresh_expires_at IS NULL OR refresh_expires_at <= created_at + INTERVAL '365 days'),
  CHECK ((refresh_token_hash IS NULL) = (refresh_expires_at IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE UNIQUE INDEX uq_oat_access_hash_active
  ON oauth_access_tokens (access_token_hash) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_oat_refresh_hash_active
  ON oauth_access_tokens (refresh_token_hash) WHERE refresh_token_hash IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX idx_oat_app             ON oauth_access_tokens (oauth_app_id, expires_at);
CREATE INDEX idx_oat_user            ON oauth_access_tokens (user_id, user_type, revoked_at);
CREATE INDEX idx_oat_tenant          ON oauth_access_tokens (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_oat_active_expiry   ON oauth_access_tokens (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_oat_refresh_expiry  ON oauth_access_tokens (refresh_expires_at) WHERE refresh_expires_at IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX idx_oat_auth_code       ON oauth_access_tokens (authorization_code_id) WHERE authorization_code_id IS NOT NULL;

ALTER TABLE oauth_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens FORCE ROW LEVEL SECURITY;
