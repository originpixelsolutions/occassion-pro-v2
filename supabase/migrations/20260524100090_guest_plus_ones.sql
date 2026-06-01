-- Phase 3 Unit 19: guest_plus_ones (spec 6.2 +1 flow).
-- A +1 hangs off a primary guest at a single event. age_category
-- enum (adult/child/infant) is required, RSVP defaults to
-- attending because the primary guest opted them in. Same
-- check-in state machine as guests (not_checked_in -> checked_in
-- -> checked_out, also no_show) with the same prereq CHECKs.
--
-- GDPR/DPDP erase: when erased_at is set, name + dietary +
-- accessibility MUST be NULL. erased_at <-> erased_reason
-- coupled both ways. App will set name='[Erased +1]' but the
-- DB only enforces it must not be the real PII.
--
-- Cross-tenant trigger: event AND primary_guest must belong to
-- the +1's tenant, and primary_guest.event_id must equal the
-- +1's event_id (no plus-ones across events).

CREATE TABLE guest_plus_ones (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id             uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  primary_guest_id     uuid        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  name                 text        CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 200),
  dietary_requirement  text        CHECK (dietary_requirement IS NULL OR length(dietary_requirement) <= 500),
  accessibility_needs  text        CHECK (accessibility_needs IS NULL OR length(accessibility_needs) <= 500),
  age_category         text        NOT NULL DEFAULT 'adult' CHECK (age_category IN ('adult','child','infant')),
  rsvp_status          text        NOT NULL DEFAULT 'attending' CHECK (rsvp_status IN ('attending','not_attending')),
  check_in_status      text        NOT NULL DEFAULT 'not_checked_in' CHECK (check_in_status IN ('not_checked_in','checked_in','checked_out','no_show')),
  check_in_at          timestamptz,
  check_out_at         timestamptz,
  erased_at            timestamptz,
  erased_reason        text        CHECK (erased_reason IS NULL OR erased_reason IN ('gdpr_request','dpdp_request','retention_policy','tenant_request','platform_action')),
  added_at             timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (check_in_status <> 'checked_in' OR check_in_at IS NOT NULL),
  CHECK (check_in_status <> 'checked_out' OR (check_in_at IS NOT NULL AND check_out_at IS NOT NULL AND check_out_at >= check_in_at)),
  CHECK ((erased_at IS NULL) = (erased_reason IS NULL)),
  CHECK (erased_at IS NULL OR (name IS NULL AND dietary_requirement IS NULL AND accessibility_needs IS NULL))
);

CREATE INDEX idx_plus_ones_primary  ON guest_plus_ones (primary_guest_id);
CREATE INDEX idx_plus_ones_event    ON guest_plus_ones (event_id);
CREATE INDEX idx_plus_ones_tenant   ON guest_plus_ones (tenant_id);
CREATE INDEX idx_plus_ones_checkin  ON guest_plus_ones (event_id, check_in_status);

CREATE OR REPLACE FUNCTION guest_plus_ones_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; guest_tenant uuid; guest_event uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  SELECT tenant_id, event_id INTO guest_tenant, guest_event FROM guests WHERE id = NEW.primary_guest_id;
  IF event_tenant IS NULL OR guest_tenant IS NULL THEN
    RAISE EXCEPTION 'guest_plus_ones parent rows not found' USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id OR guest_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'guest_plus_ones.tenant_id % does not match event/guest tenants', NEW.tenant_id USING ERRCODE = '23514';
  END IF;
  IF guest_event <> NEW.event_id THEN
    RAISE EXCEPTION 'guest_plus_ones.primary_guest_id % belongs to event %, not %', NEW.primary_guest_id, guest_event, NEW.event_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guest_plus_ones_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, primary_guest_id ON guest_plus_ones
  FOR EACH ROW EXECUTE FUNCTION guest_plus_ones_check_tenant_match();

ALTER TABLE guest_plus_ones ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_plus_ones FORCE ROW LEVEL SECURITY;
