-- Phase 2 Unit 9: tenant_external_storage (spec 8).
-- BYO storage configs (S3 / R2 / Drive / Dropbox / OneDrive / B2 / Wasabi).
-- Tokens are encrypted at the app layer via libsodium; DB only sees bytes.

CREATE TABLE tenant_external_storage (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  provider                text        NOT NULL CHECK (provider IN (
                                        'google_drive','dropbox','onedrive','s3','r2','b2','wasabi'
                                      )),
  access_token_encrypted  bytea       NOT NULL CHECK (octet_length(access_token_encrypted) > 0),
  refresh_token_encrypted bytea       CHECK (refresh_token_encrypted IS NULL OR octet_length(refresh_token_encrypted) > 0),
  token_expires_at        timestamptz,
  root_folder_id          text        CHECK (root_folder_id IS NULL OR length(trim(root_folder_id)) > 0),
  display_name            text        CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 120),
  is_default              boolean     NOT NULL DEFAULT FALSE,
  connected_by            uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  status                  text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'expired' OR token_expires_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_tenant_storage_default_active
  ON tenant_external_storage (tenant_id)
  WHERE is_default AND status = 'active';

CREATE INDEX idx_tenant_ext_storage_active   ON tenant_external_storage (tenant_id) WHERE status = 'active';
CREATE INDEX idx_tenant_ext_storage_provider ON tenant_external_storage (tenant_id, provider);
CREATE INDEX idx_tenant_ext_storage_conn_by  ON tenant_external_storage (connected_by) WHERE connected_by IS NOT NULL;

ALTER TABLE tenant_external_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_external_storage FORCE ROW LEVEL SECURITY;
