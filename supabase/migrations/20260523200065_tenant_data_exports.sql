-- Phase 2 Unit 14: tenant_data_exports (spec 3.16.1).
-- GDPR/DPDP self-serve export jobs. State machine queued -> running ->
-- completed (with zip_url + expiry) | failed (with error_message).
-- expired = was completed but past zip_expires_at.

CREATE TABLE tenant_data_exports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  requested_by   uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  export_type    text        NOT NULL CHECK (export_type IN ('full','pre_downgrade','pre_cancellation','dsar')),
  status         text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','expired')),
  zip_url        text        CHECK (zip_url IS NULL OR zip_url ~ '^https://'),
  zip_size_bytes bigint      CHECK (zip_size_bytes IS NULL OR zip_size_bytes >= 0),
  zip_expires_at timestamptz,
  started_at     timestamptz,
  completed_at   timestamptz,
  error_message  text        CHECK (error_message IS NULL OR length(error_message) <= 2000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'running'   OR started_at IS NOT NULL),
  CHECK (status <> 'completed' OR (started_at IS NOT NULL AND completed_at IS NOT NULL AND zip_url IS NOT NULL AND zip_expires_at IS NOT NULL)),
  CHECK (status <> 'failed'    OR (completed_at IS NOT NULL AND error_message IS NOT NULL)),
  CHECK (status <> 'expired'   OR (completed_at IS NOT NULL AND zip_expires_at IS NOT NULL)),
  CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CHECK (zip_expires_at IS NULL OR zip_expires_at > completed_at)
);

CREATE INDEX idx_data_exports_tenant       ON tenant_data_exports (tenant_id, created_at DESC);
CREATE INDEX idx_data_exports_running      ON tenant_data_exports (created_at) WHERE status IN ('queued','running');
CREATE INDEX idx_data_exports_expiring     ON tenant_data_exports (zip_expires_at) WHERE status = 'completed';
CREATE INDEX idx_data_exports_requested_by ON tenant_data_exports (requested_by) WHERE requested_by IS NOT NULL;

ALTER TABLE tenant_data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data_exports FORCE ROW LEVEL SECURITY;
