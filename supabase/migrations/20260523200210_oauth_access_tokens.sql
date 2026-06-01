-- Phase 2 Unit 43: oauth_access_tokens (spec 31.7, RFC 6749).
-- Access + refresh tokens stored as sha256(token); plaintext leaves once at
-- issuance. 90-day access-token ceiling. refresh_token_hash + refresh_expires_at
-- coupled. Partial UNIQUEs scoped to non-revoked rows so rotation history persists.

CREATE TABLE oauth_access_tokens (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  oauth_app_id           uuid        NOT NULL REFERENCES tenant_oauth_apps (id) ON DELETE CASCADE,
  authorization_code_id  uuid        REFERENCES oauth_authorization_codes (id) ON DELETE SET NULL,
  access_token_hash      text        NOT NULL CHECK (length(access_token_hash) = 64),
  refresh_token_hash     text        CHECK (refresh_token_hash IS NULL OR length(refresh_token_hash) = 64),
  user_id                uuid        NOT NULL,
  user_type              text        NOT NULL CHECK (user_type IN ('tenant_member','super_admin','client','vendor','speaker')),
  tenant_id              uuid        REFERENCES tenants (id) ON DELETE CASCADE,
  scopes                 text[]      NOT NULL CHECK (cardinality(scopes) >= 1),
  ip_address             inet,
  user_agent             text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  expires_at             timestamptz NOT NULL,
  refresh_expires_at     timestamptz,
  last_used_at           timestamptz,
  revoked_at             timestamptz,
  revoke_reason          text        CHECK (revoke_reason IS NULL OR revoke_reason IN (
                                       'user_logout','admin_revoke','refresh_rotation','app_revoked',
                                       'scope_change','suspicious','concurrent_limit','user_account_deleted'
                                     )),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + INTERVAL '90 days'),
  CHECK (refresh_expires_at IS NULL OR refresh_expires_at > created_at),
  CHECK ((refresh_token_hash IS NULL) = (refresh_expires_at IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CHECK (last_used_at IS NULL OR last_used_at >= created_at)
);

CREATE UNIQUE INDEX uq_oat_access_token_active
  ON oauth_access_tokens (access_token_hash) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_oat_refresh_token_active
  ON oauth_access_tokens (refresh_token_hash) WHERE revoked_at IS NULL AND refresh_token_hash IS NOT NULL;

CREATE INDEX idx_oat_app         ON oauth_access_tokens (oauth_app_id, expires_at);
CREATE INDEX idx_oat_user        ON oauth_access_tokens (user_id, user_type, revoked_at);
CREATE INDEX idx_oat_tenant      ON oauth_access_tokens (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_oat_active_exp  ON oauth_access_tokens (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_oat_refresh_exp ON oauth_access_tokens (refresh_expires_at) WHERE revoked_at IS NULL AND refresh_expires_at IS NOT NULL;
CREATE INDEX idx_oat_authcode    ON oauth_access_tokens (authorization_code_id) WHERE authorization_code_id IS NOT NULL;

ALTER TABLE oauth_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens FORCE ROW LEVEL SECURITY;
