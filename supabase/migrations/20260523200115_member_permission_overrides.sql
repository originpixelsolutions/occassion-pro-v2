-- Phase 2 Unit 24: member_permission_overrides (spec 2.4).
-- Per-member nullable override matrix layered on top of module_permissions.
-- NULL = inherit role-level value; TRUE/FALSE = explicit grant/deny.

CREATE TABLE member_permission_overrides (
  tenant_id  uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  member_id  uuid        NOT NULL REFERENCES tenant_members (id) ON DELETE CASCADE,
  module     text        NOT NULL CHECK (module IN (
                           'events','event_templates','event_types','clients','vendors','guests',
                           'runsheet','budget','expenses','payments','invoices','contracts',
                           'documents','tasks','crew','f_and_b','inventory','floorplan',
                           'shared_inbox','calendar','reports','team_members','settings','billing',
                           'integrations','audit_log','api_keys','custom_domains','sso','exports','webhooks'
                         )),
  can_read   boolean,
  can_write  boolean,
  can_delete boolean,
  can_export boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, member_id, module),
  CHECK (
    can_read   IS NOT NULL
    OR can_write  IS NOT NULL
    OR can_delete IS NOT NULL
    OR can_export IS NOT NULL
  ),
  CHECK (NOT (can_write  IS TRUE AND can_read IS FALSE)),
  CHECK (NOT (can_delete IS TRUE AND can_read IS FALSE)),
  CHECK (NOT (can_export IS TRUE AND can_read IS FALSE))
);

CREATE INDEX idx_mpo_tenant     ON member_permission_overrides (tenant_id);
CREATE INDEX idx_mpo_member     ON member_permission_overrides (member_id);
CREATE INDEX idx_mpo_module     ON member_permission_overrides (module);
CREATE INDEX idx_mpo_updated_by ON member_permission_overrides (updated_by) WHERE updated_by IS NOT NULL;

ALTER TABLE member_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_permission_overrides FORCE ROW LEVEL SECURITY;
