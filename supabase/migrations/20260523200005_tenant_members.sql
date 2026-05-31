-- Phase 2 Unit 2: tenant_members
-- Composed from spec 2.2 (Layer 3 roles), 2.5 (one_owner_per_workspace),
-- 2.6 (impersonation), 3.8 (invitation), 19 (recovery email + phone).
-- Resolves Phase 1 deferred FK event_templates.created_by -> tenant_members.

CREATE TABLE tenant_members (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           citext      NOT NULL,
  full_name       text        NOT NULL CHECK (length(trim(full_name)) > 0),
  role            text        NOT NULL CHECK (role IN (
                                'owner','event_manager','team_lead','team_member'
                              )),
  recovery_email  citext,
  recovery_phone  text        CHECK (
                                recovery_phone IS NULL
                                OR recovery_phone ~ '^\+[1-9][0-9]{6,14}$'
                              ),
  invited_by      uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  invited_at      timestamptz,
  accepted_at     timestamptz,
  last_active_at  timestamptz,
  removed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (removed_at IS NULL OR removed_at <= now()),
  CHECK (accepted_at IS NULL OR invited_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_tenant_members_email_active
  ON tenant_members (tenant_id, email) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX one_owner_per_workspace
  ON tenant_members (tenant_id) WHERE role = 'owner' AND removed_at IS NULL;
CREATE INDEX idx_tenant_members_tenant_active
  ON tenant_members (tenant_id) WHERE removed_at IS NULL;
CREATE INDEX idx_tenant_members_invited_by
  ON tenant_members (invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX idx_tenant_members_last_active
  ON tenant_members (last_active_at) WHERE removed_at IS NULL;

CREATE OR REPLACE FUNCTION tenant_members_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_tenant_members_updated_at
  BEFORE UPDATE ON tenant_members
  FOR EACH ROW EXECUTE FUNCTION tenant_members_set_updated_at();

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members FORCE ROW LEVEL SECURITY;

ALTER TABLE event_templates
  ADD CONSTRAINT event_templates_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES tenant_members(id) ON DELETE SET NULL;

CREATE INDEX idx_event_templates_created_by
  ON event_templates (created_by) WHERE created_by IS NOT NULL;
