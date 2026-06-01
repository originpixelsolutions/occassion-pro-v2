-- Phase 2 Unit 42: oauth_authorization_codes (spec 31.7, RFC 6749).
-- One-shot OAuth 2.0 authorization codes. code_hash = sha256(code);
-- plaintext leaves the server exactly once via the auth redirect.
-- 10-min hard ceiling per RFC; PKCE (code_challenge + S256/plain method)
-- optional but coupled.

CREATE TABLE oauth_authorization_codes (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  oauth_app_id           uuid        NOT NULL REFERENCES tenant_oauth_apps (id) ON DELETE CASCADE,
  code_hash              text        NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  user_id                uuid        NOT NULL,
  user_type              text        NOT NULL CHECK (user_type IN ('tenant_member','super_admin','client','vendor','speaker')),
  tenant_id              uuid        REFERENCES tenants (id) ON DELETE CASCADE,
  redirect_uri           text        NOT NULL CHECK (length(redirect_uri) BETWEEN 8 AND 2048 AND (redirect_uri ~ '^https://' OR redirect_uri ~ '^http://localhost(:[0-9]+)?(/|$)')),
  scopes                 text[]      NOT NULL CHECK (cardinality(scopes) >= 1),
  code_challenge         text        CHECK (code_challenge IS NULL OR length(code_challenge) BETWEEN 43 AND 128),
  code_challenge_method  text        CHECK (code_challenge_method IS NULL OR code_challenge_method IN ('S256','plain')),
  ip_address             inet,
  user_agent             text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  expires_at             timestamptz NOT NULL,
  consumed_at            timestamptz,
  consumed_ip            inet,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + INTERVAL '10 minutes'),
  CHECK ((consumed_at IS NULL) = (consumed_ip IS NULL)),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK ((code_challenge IS NULL) = (code_challenge_method IS NULL))
);

CREATE INDEX idx_oac_app    ON oauth_authorization_codes (oauth_app_id, expires_at);
CREATE INDEX idx_oac_user   ON oauth_authorization_codes (user_id, user_type, consumed_at);
CREATE INDEX idx_oac_tenant ON oauth_authorization_codes (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_oac_expiry ON oauth_authorization_codes (expires_at) WHERE consumed_at IS NULL;

ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_codes FORCE ROW LEVEL SECURITY;
