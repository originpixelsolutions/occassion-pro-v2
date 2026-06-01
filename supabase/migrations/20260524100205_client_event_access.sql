-- Phase 4 Unit 41: client_event_access (spec line 1896).
-- Junction granting a client_account access to one or more
-- events. Powers the client portal multi-event view ("My
-- Events") so a single client can manage multiple events
-- across one or more tenants from one login.
--
-- role enum (extension): primary | secondary | viewer |
-- approver | signer. permissions jsonb is a flexible
-- additional grant store (per-section toggles) capped at 16
-- KiB and shape-checked to be an object.
--
-- Lifecycle: invited -> accepted (sets accepted_at) -> revoked
-- (sets revoked_at + revoked_by + revoked_reason). Per-state
-- prereq: revoking requires the by+reason pair. Time-order
-- CHECKs prevent accepted/revoked before invited.
--
-- Spec-mandated UNIQUE (client_account_id, event_id): a
-- client can hold at most one access row per event. To
-- re-invite after revoke, app updates the existing row
-- (clearing revoked_*) rather than inserting a new row.
--
-- Three-way tenant-match trigger: event + invited_by + revoked_by
-- all belong to the access row's tenant. An attacker in
-- tenant A cannot have tenant B record itself as inviter or
-- revoker on a tenant A access row.

CREATE TABLE client_event_access (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_account_id uuid        NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id          uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  permissions       jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions) = 'object' AND pg_column_size(permissions) < 16384),
  role              text        NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','secondary','viewer','approver','signer')),
  invited_by        uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  invited_at        timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  revoked_reason    text        CHECK (revoked_reason IS NULL OR length(revoked_reason) <= 2000),
  last_accessed_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (revoked_at IS NULL OR (revoked_by IS NOT NULL AND revoked_reason IS NOT NULL)),
  CHECK (accepted_at IS NULL OR accepted_at >= invited_at),
  CHECK (revoked_at IS NULL OR revoked_at >= invited_at)
);

CREATE UNIQUE INDEX uq_client_event_access ON client_event_access (client_account_id, event_id);

CREATE INDEX idx_client_event_access_client     ON client_event_access (client_account_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_client_event_access_event      ON client_event_access (event_id);
CREATE INDEX idx_client_event_access_tenant     ON client_event_access (tenant_id);
CREATE INDEX idx_client_event_access_invited_by ON client_event_access (invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX idx_client_event_access_pending    ON client_event_access (event_id, invited_at) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_client_event_access_role       ON client_event_access (event_id, role) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION client_event_access_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; inviter_tenant uuid; revoker_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'client_event_access.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'client_event_access.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  IF NEW.invited_by IS NOT NULL THEN
    SELECT tenant_id INTO inviter_tenant FROM tenant_members WHERE id = NEW.invited_by;
    IF inviter_tenant IS NULL OR inviter_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'client_event_access.invited_by % does not belong to tenant %', NEW.invited_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.revoked_by IS NOT NULL THEN
    SELECT tenant_id INTO revoker_tenant FROM tenant_members WHERE id = NEW.revoked_by;
    IF revoker_tenant IS NULL OR revoker_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'client_event_access.revoked_by % does not belong to tenant %', NEW.revoked_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_client_event_access_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, invited_by, revoked_by ON client_event_access
  FOR EACH ROW EXECUTE FUNCTION client_event_access_check_tenant_match();

ALTER TABLE client_event_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_event_access FORCE ROW LEVEL SECURITY;
