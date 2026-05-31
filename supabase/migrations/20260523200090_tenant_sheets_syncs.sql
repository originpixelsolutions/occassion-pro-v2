-- Phase 2 Unit 19: tenant_sheets_syncs (spec 31.5).
-- Per-event Google Sheets two-way sync. event_id FK to events table
-- lands in Phase 3; for now just a uuid + idx.

CREATE TABLE tenant_sheets_syncs (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_id                uuid        NOT NULL,
  resource                text        NOT NULL CHECK (resource IN ('guests','vendors','runsheet','budget','payments')),
  sheet_id                text        NOT NULL CHECK (length(trim(sheet_id)) > 0),
  sheet_tab_name          text        NOT NULL CHECK (length(trim(sheet_tab_name)) BETWEEN 1 AND 100),
  sheet_url               text        CHECK (sheet_url IS NULL OR sheet_url ~ '^https://docs\.google\.com/spreadsheets/'),
  access_token_encrypted  bytea       NOT NULL CHECK (octet_length(access_token_encrypted) > 0),
  refresh_token_encrypted bytea       CHECK (refresh_token_encrypted IS NULL OR octet_length(refresh_token_encrypted) > 0),
  token_expires_at        timestamptz,
  sync_direction          text        NOT NULL DEFAULT 'two_way' CHECK (sync_direction IN ('to_sheets','from_sheets','two_way')),
  column_mapping          jsonb       NOT NULL CHECK (jsonb_typeof(column_mapping) = 'object'),
  configured_by           uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  last_synced_at          timestamptz,
  last_error              text        CHECK (last_error IS NULL OR length(last_error) <= 2000),
  status                  text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected','error')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'expired' OR token_expires_at IS NOT NULL),
  CHECK (status <> 'error'   OR last_error IS NOT NULL)
);

CREATE UNIQUE INDEX uq_tss_active_per_event_resource
  ON tenant_sheets_syncs (event_id, resource)
  WHERE status IN ('active','error');

CREATE INDEX idx_tss_tenant         ON tenant_sheets_syncs (tenant_id);
CREATE INDEX idx_tss_event          ON tenant_sheets_syncs (event_id);
CREATE INDEX idx_tss_active         ON tenant_sheets_syncs (tenant_id) WHERE status = 'active';
CREATE INDEX idx_tss_last_synced    ON tenant_sheets_syncs (last_synced_at) WHERE status = 'active';
CREATE INDEX idx_tss_token_expiring ON tenant_sheets_syncs (token_expires_at) WHERE status = 'active' AND token_expires_at IS NOT NULL;
CREATE INDEX idx_tss_configured_by  ON tenant_sheets_syncs (configured_by) WHERE configured_by IS NOT NULL;

ALTER TABLE tenant_sheets_syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sheets_syncs FORCE ROW LEVEL SECURITY;
