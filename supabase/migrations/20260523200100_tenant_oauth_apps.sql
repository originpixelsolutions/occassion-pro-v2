-- Phase 2 Unit 21: tenant_oauth_apps (spec 31.7).
-- Tenant-owned OAuth 2.0 client apps for Zapier/Make/n8n marketplaces.
-- client_id is the public op_app_<16-alphanum> identifier.
-- client_secret_hash is sha256 of the issued secret (length-64 hex).
-- redirect_uris validated by trigger: https or http://localhost(:port) only.

CREATE TABLE tenant_oauth_apps (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  client_id           text        NOT NULL UNIQUE CHECK (client_id ~ '^op_app_[A-Za-z0-9]{16}$'),
  client_secret_hash  text        NOT NULL CHECK (length(client_secret_hash) = 64),
  name                text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description         text        CHECK (description IS NULL OR length(description) <= 1000),
  redirect_uris       text[]      NOT NULL CHECK (cardinality(redirect_uris) >= 1),
  scopes              text[]      NOT NULL CHECK (cardinality(scopes) >= 1),
  grant_types         text[]      NOT NULL DEFAULT ARRAY['authorization_code','refresh_token']::text[]
                                     CHECK (cardinality(grant_types) >= 1),
  homepage_url        text        CHECK (homepage_url IS NULL OR homepage_url ~ '^https://'),
  logo_url            text        CHECK (logo_url IS NULL OR logo_url ~ '^https://'),
  is_public_listed    boolean     NOT NULL DEFAULT FALSE,
  created_by          uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  status              text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  suspended_at        timestamptz,
  suspended_reason    text        CHECK (suspended_reason IS NULL OR length(suspended_reason) <= 500),
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'suspended' OR (suspended_at IS NOT NULL AND suspended_reason IS NOT NULL)),
  CHECK (status <> 'revoked'   OR revoked_at  IS NOT NULL)
);

CREATE OR REPLACE FUNCTION trg_toa_validate_redirects() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE u text;
BEGIN
  FOREACH u IN ARRAY NEW.redirect_uris LOOP
    IF u IS NULL
       OR length(u) < 8
       OR length(u) > 2048
       OR (u !~ '^https://' AND u !~ '^http://localhost(:[0-9]+)?(/|$)')
    THEN
      RAISE EXCEPTION 'toa_invalid_redirect: % (must be https or http://localhost)', u
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_toa_validate_redirects
BEFORE INSERT OR UPDATE ON tenant_oauth_apps
FOR EACH ROW EXECUTE FUNCTION trg_toa_validate_redirects();

CREATE INDEX idx_toa_tenant_active ON tenant_oauth_apps (tenant_id) WHERE status = 'active';
CREATE INDEX idx_toa_listed        ON tenant_oauth_apps (id) WHERE is_public_listed AND status = 'active';
CREATE INDEX idx_toa_created_by    ON tenant_oauth_apps (created_by) WHERE created_by IS NOT NULL;

ALTER TABLE tenant_oauth_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_oauth_apps FORCE ROW LEVEL SECURITY;
