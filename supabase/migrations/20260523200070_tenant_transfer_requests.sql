-- Phase 2 Unit 15: tenant_transfer_requests (spec 3.16.2).
-- M&A workspace-to-workspace data transfer. Three-party approval
-- (source owner -> target owner -> super-admin with legal docs).
-- 8-state machine. Only one active transfer per source tenant.

CREATE TABLE tenant_transfer_requests (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_tenant_id     uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  target_tenant_id     uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  initiated_by         uuid        NOT NULL REFERENCES tenant_members (id) ON DELETE RESTRICT,
  target_confirmed_by  uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  scope                jsonb       NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  legal_documents_url  text        CHECK (legal_documents_url IS NULL OR legal_documents_url ~ '^https://'),
  approved_by_admin    uuid        REFERENCES super_admins (id) ON DELETE SET NULL,
  status               text        NOT NULL DEFAULT 'requested' CHECK (status IN (
                                     'requested','target_confirmed','admin_approved',
                                     'running','completed','rejected','failed','cancelled'
                                   )),
  started_at           timestamptz,
  completed_at         timestamptz,
  error_message        text        CHECK (error_message IS NULL OR length(error_message) <= 2000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (source_tenant_id <> target_tenant_id),
  CHECK (status <> 'target_confirmed' OR target_confirmed_by IS NOT NULL),
  CHECK (status <> 'admin_approved'   OR (target_confirmed_by IS NOT NULL AND approved_by_admin IS NOT NULL AND legal_documents_url IS NOT NULL)),
  CHECK (status <> 'running'          OR (approved_by_admin IS NOT NULL AND started_at IS NOT NULL)),
  CHECK (status <> 'completed'        OR (started_at IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (status <> 'failed'           OR (started_at IS NOT NULL AND completed_at IS NOT NULL AND error_message IS NOT NULL)),
  CHECK (completed_at IS NULL OR started_at IS NOT NULL)
);

CREATE INDEX idx_transfer_source       ON tenant_transfer_requests (source_tenant_id);
CREATE INDEX idx_transfer_target       ON tenant_transfer_requests (target_tenant_id);
CREATE INDEX idx_transfer_initiated_by ON tenant_transfer_requests (initiated_by);
CREATE INDEX idx_transfer_pending      ON tenant_transfer_requests (created_at) WHERE status IN ('requested','target_confirmed','admin_approved','running');

CREATE UNIQUE INDEX uq_transfer_active_source
  ON tenant_transfer_requests (source_tenant_id)
  WHERE status IN ('requested','target_confirmed','admin_approved','running');

ALTER TABLE tenant_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_transfer_requests FORCE ROW LEVEL SECURITY;
