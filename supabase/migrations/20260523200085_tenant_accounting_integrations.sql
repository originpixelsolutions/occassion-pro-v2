-- Phase 2 Unit 18: tenant_accounting_integrations (spec 31.4).
-- QuickBooks / Tally / Zoho Books / Xero / Wave. Same pattern as CRM
-- integrations, with default GL accounts and a realm/company ID slot.

CREATE TABLE tenant_accounting_integrations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  provider                text        NOT NULL CHECK (provider IN ('quickbooks','tally','zoho_books','xero','wave')),
  access_token_encrypted  bytea       NOT NULL CHECK (octet_length(access_token_encrypted) > 0),
  refresh_token_encrypted bytea       CHECK (refresh_token_encrypted IS NULL OR octet_length(refresh_token_encrypted) > 0),
  token_expires_at        timestamptz,
  realm_id                text        CHECK (realm_id IS NULL OR length(trim(realm_id)) > 0),
  default_revenue_account text        CHECK (default_revenue_account IS NULL OR length(trim(default_revenue_account)) > 0),
  default_tax_account     text        CHECK (default_tax_account     IS NULL OR length(trim(default_tax_account))     > 0),
  sync_direction          text        NOT NULL DEFAULT 'to_accounting' CHECK (sync_direction IN ('to_accounting','from_accounting','two_way')),
  field_mapping           jsonb       NOT NULL CHECK (jsonb_typeof(field_mapping) = 'object'),
  last_synced_at          timestamptz,
  status                  text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected','error')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'expired' OR token_expires_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_tai_active_per_tenant_provider
  ON tenant_accounting_integrations (tenant_id, provider)
  WHERE status = 'active';

CREATE INDEX idx_tai_tenant_active  ON tenant_accounting_integrations (tenant_id) WHERE status = 'active';
CREATE INDEX idx_tai_provider       ON tenant_accounting_integrations (provider);
CREATE INDEX idx_tai_last_synced    ON tenant_accounting_integrations (last_synced_at) WHERE status = 'active';
CREATE INDEX idx_tai_token_expiring ON tenant_accounting_integrations (token_expires_at) WHERE status = 'active' AND token_expires_at IS NOT NULL;

ALTER TABLE tenant_accounting_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_accounting_integrations FORCE ROW LEVEL SECURITY;
