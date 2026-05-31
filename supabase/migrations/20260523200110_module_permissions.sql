-- Phase 2 Unit 23: module_permissions (spec 2.4).
-- Per-tenant per-role per-module RBAC matrix. owner role is implicit
-- all-true; only the 3 lower roles get rows. delete/export/write each
-- imply read.

CREATE TABLE module_permissions (
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('event_manager','team_lead','team_member')),
  module     text        NOT NULL CHECK (module IN (
                           'events','event_templates','event_types','clients','vendors','guests',
                           'runsheet','budget','expenses','payments','invoices','contracts',
                           'documents','tasks','crew','f_and_b','inventory','floorplan',
                           'shared_inbox','calendar','reports','team_members','settings','billing',
                           'integrations','audit_log','api_keys','custom_domains','sso','exports','webhooks'
                         )),
  can_read   boolean     NOT NULL DEFAULT FALSE,
  can_write  boolean     NOT NULL DEFAULT FALSE,
  can_delete boolean     NOT NULL DEFAULT FALSE,
  can_export boolean     NOT NULL DEFAULT FALSE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, role, module),
  CHECK (NOT can_write  OR can_read),
  CHECK (NOT can_delete OR can_read),
  CHECK (NOT can_export OR can_read)
);

CREATE INDEX idx_mp_tenant     ON module_permissions (tenant_id);
CREATE INDEX idx_mp_module     ON module_permissions (module);
CREATE INDEX idx_mp_updated_by ON module_permissions (updated_by) WHERE updated_by IS NOT NULL;

ALTER TABLE module_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_permissions FORCE ROW LEVEL SECURITY;
