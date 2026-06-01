-- Phase 3 Unit 3: event_subteam_members (spec 2.4.1).
-- Member assignments into per-event subteams. Composite PK
-- (subteam_id, member_id). Trigger blocks cross-tenant assignment.

CREATE TABLE event_subteam_members (
  subteam_id uuid        NOT NULL REFERENCES event_subteams (id) ON DELETE CASCADE,
  member_id  uuid        NOT NULL REFERENCES tenant_members (id) ON DELETE CASCADE,
  role_label text        CHECK (role_label IS NULL OR length(trim(role_label)) BETWEEN 1 AND 80),
  added_by   uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subteam_id, member_id)
);

CREATE INDEX idx_event_subteam_members_member   ON event_subteam_members (member_id);
CREATE INDEX idx_event_subteam_members_added_by ON event_subteam_members (added_by) WHERE added_by IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_event_subteam_members_tenant_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  subteam_tenant uuid;
  member_tenant  uuid;
BEGIN
  SELECT tenant_id INTO subteam_tenant FROM event_subteams  WHERE id = NEW.subteam_id;
  SELECT tenant_id INTO member_tenant  FROM tenant_members  WHERE id = NEW.member_id;
  IF subteam_tenant IS NULL OR member_tenant IS NULL OR subteam_tenant <> member_tenant THEN
    RAISE EXCEPTION 'event_subteam_members_tenant_mismatch: subteam tenant (%) <> member tenant (%)',
                    subteam_tenant, member_tenant
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_subteam_members_tenant_match
BEFORE INSERT OR UPDATE OF subteam_id, member_id ON event_subteam_members
FOR EACH ROW EXECUTE FUNCTION trg_event_subteam_members_tenant_match();

ALTER TABLE event_subteam_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subteam_members FORCE ROW LEVEL SECURITY;
