-- Phase 2 Unit 17: tenant_crm_integrations (spec 31.3).
-- Per-tenant CRM OAuth + field-mapping. Tokens stored as bytea
-- ciphertext (libsodium sealed at the app layer). One active
-- integration per (tenant, provider).

CREATE TABLE tenant_crm_integrations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  provider                text        NOT NULL CHECK (provider IN ('salesforce','hubspot','zoho_crm','pipedrive','freshsales')),
  access_token_encrypted  bytea       NOT NULL CHECK (octet_length(access_token_encrypted) > 0),
  refresh_token_encrypted bytea       CHECK (refresh_token_encrypted IS NULL OR octet_length(refresh_token_encrypted) > 0),
  token_expires_at        timestamptz,
  workspace_id            text        CHECK (workspace_id IS NULL OR length(trim(workspace_id)) > 0),
  sync_direction          text        NOT NULL DEFAULT 'two_way' CHECK (sync_direction IN ('to_crm','from_crm','two_way')),
  field_mapping           jsonb       NOT NULL CHECK (jsonb_typeof(field_mapping) = 'object'),
  last_synced_at          timestamptz,
  status                  text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected','error')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'expired' OR token_expires_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_tci_active_per_tenant_provider
  ON tenant_crm_integrations (tenant_id, provider)
  WHERE status = 'active';

CREATE INDEX idx_tci_tenant_active  ON tenant_crm_integrations (tenant_id) WHERE status = 'active';
CREATE INDEX idx_tci_provider       ON tenant_crm_integrations (provider);
CREATE INDEX idx_tci_last_synced    ON tenant_crm_integrations (last_synced_at) WHERE status = 'active';
CREATE INDEX idx_tci_token_expiring ON tenant_crm_integrations (token_expires_at) WHERE status = 'active' AND token_expires_at IS NOT NULL;

ALTER TABLE tenant_crm_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_crm_integrations FORCE ROW LEVEL SECURITY;
