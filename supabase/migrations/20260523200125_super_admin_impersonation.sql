-- Phase 2 Unit 26: super_admin_impersonation (spec 2.6).
-- Audit log of super-admin "log in as tenant member" sessions.
-- Append-only via trigger; only ended_at, action_count, and user_agent
-- may be updated after insert. RESTRICT on super_admin_id and
-- impersonated_user so those rows can't be hard-deleted while history exists.

CREATE TABLE super_admin_impersonation (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id    uuid        NOT NULL REFERENCES super_admins (id) ON DELETE RESTRICT,
  tenant_id         uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  impersonated_user uuid        NOT NULL REFERENCES tenant_members (id) ON DELETE RESTRICT,
  reason            text        NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 2000),
  source_ip         inet,
  user_agent        text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  action_count      integer     NOT NULL DEFAULT 0 CHECK (action_count >= 0),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX idx_sai_super_admin   ON super_admin_impersonation (super_admin_id, started_at);
CREATE INDEX idx_sai_tenant        ON super_admin_impersonation (tenant_id, started_at);
CREATE INDEX idx_sai_impersonated  ON super_admin_impersonation (impersonated_user, started_at);
CREATE INDEX idx_sai_open_sessions ON super_admin_impersonation (started_at) WHERE ended_at IS NULL;

ALTER TABLE super_admin_impersonation ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admin_impersonation FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION trg_sai_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id                <> OLD.id                THEN RAISE EXCEPTION 'immutable: id'                USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.super_admin_id    <> OLD.super_admin_id    THEN RAISE EXCEPTION 'immutable: super_admin_id'    USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.tenant_id         <> OLD.tenant_id         THEN RAISE EXCEPTION 'immutable: tenant_id'         USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.impersonated_user <> OLD.impersonated_user THEN RAISE EXCEPTION 'immutable: impersonated_user' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.reason            <> OLD.reason            THEN RAISE EXCEPTION 'immutable: reason'            USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.started_at        <> OLD.started_at        THEN RAISE EXCEPTION 'immutable: started_at'        USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.source_ip IS DISTINCT FROM OLD.source_ip   THEN RAISE EXCEPTION 'immutable: source_ip'         USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sai_append_only
BEFORE UPDATE ON super_admin_impersonation
FOR EACH ROW EXECUTE FUNCTION trg_sai_append_only();
