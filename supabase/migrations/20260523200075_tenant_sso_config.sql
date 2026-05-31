-- Phase 2 Unit 16: tenant_sso_config (spec 31.1).
-- WorkOS-backed SSO/SCIM config per tenant. PK = tenant_id (singleton).
-- config_encrypted = libsodium-sealed SAML XML or OIDC JSON.
-- Per-element domain validation runs in a trigger because CHECK
-- constraints can't use subqueries.

CREATE TABLE tenant_sso_config (
  tenant_id          uuid        PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  provider           text        NOT NULL CHECK (provider IN (
                                   'google_workspace','microsoft_365','okta','onelogin',
                                   'azure_ad','custom_saml','custom_oidc'
                                 )),
  config_encrypted   bytea       NOT NULL CHECK (octet_length(config_encrypted) > 0),
  domain_restriction text[]      CHECK (domain_restriction IS NULL OR cardinality(domain_restriction) >= 1),
  enforce_sso        boolean     NOT NULL DEFAULT FALSE,
  auto_provision     boolean     NOT NULL DEFAULT TRUE,
  default_role       text        NOT NULL DEFAULT 'team_member' CHECK (default_role IN ('owner','event_manager','team_lead','team_member')),
  configured_by      uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  configured_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);

CREATE OR REPLACE FUNCTION trg_tsc_validate_domains() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d text;
BEGIN
  IF NEW.domain_restriction IS NULL THEN RETURN NEW; END IF;
  FOREACH d IN ARRAY NEW.domain_restriction LOOP
    IF d IS NULL OR d <> lower(d) OR d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
      RAISE EXCEPTION 'tsc_invalid_domain: % (must be lowercase fqdn)', d
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_tsc_validate_domains
BEFORE INSERT OR UPDATE ON tenant_sso_config
FOR EACH ROW EXECUTE FUNCTION trg_tsc_validate_domains();

CREATE INDEX idx_tsc_provider      ON tenant_sso_config (provider);
CREATE INDEX idx_tsc_configured_by ON tenant_sso_config (configured_by) WHERE configured_by IS NOT NULL;
CREATE INDEX idx_tsc_enforced      ON tenant_sso_config (tenant_id) WHERE enforce_sso;

ALTER TABLE tenant_sso_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sso_config FORCE ROW LEVEL SECURITY;
