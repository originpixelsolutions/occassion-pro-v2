-- Phase 3 Unit 2: event_subteams (spec 2.4.1).
-- Per-event sub-teams. Soft-delete via removed_at. UNIQUE (event_id,
-- lower(name)) WHERE active, and UNIQUE (event_id, lead_id) WHERE active
-- + non-NULL. Trigger enforces tenant_id matches parent events.tenant_id.

CREATE TABLE event_subteams (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_id    uuid        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  color_hex   text        CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  description text        CHECK (description IS NULL OR length(description) <= 2000),
  lead_id     uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  removed_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_event_subteams_name_active
  ON event_subteams (event_id, lower(name)) WHERE removed_at IS NULL;

CREATE UNIQUE INDEX uq_event_subteams_lead_active
  ON event_subteams (event_id, lead_id) WHERE removed_at IS NULL AND lead_id IS NOT NULL;

CREATE INDEX idx_event_subteams_tenant ON event_subteams (tenant_id);
CREATE INDEX idx_event_subteams_event  ON event_subteams (event_id);
CREATE INDEX idx_event_subteams_lead   ON event_subteams (lead_id) WHERE lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_event_subteams_tenant_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE evt_tenant uuid;
BEGIN
  SELECT tenant_id INTO evt_tenant FROM events WHERE id = NEW.event_id;
  IF evt_tenant IS NULL OR evt_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'event_subteams_tenant_mismatch: subteam.tenant_id (%) does not match events.tenant_id (%)',
                    NEW.tenant_id, evt_tenant
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_subteams_tenant_match
BEFORE INSERT OR UPDATE OF tenant_id, event_id ON event_subteams
FOR EACH ROW EXECUTE FUNCTION trg_event_subteams_tenant_match();

ALTER TABLE event_subteams ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subteams FORCE ROW LEVEL SECURITY;
