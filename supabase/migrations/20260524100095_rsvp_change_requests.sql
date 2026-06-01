-- Phase 3 Unit 20: rsvp_change_requests (spec 6.2 'I Changed
-- My Mind' flow).
--
-- After events.rsvp_change_deadline_at, guests can't freely flip
-- their RSVP. Instead, the portal files a change request that
-- the event manager must approve or reject. Status enum:
-- pending -> approved | rejected.
--
-- Per-state prereqs enforced via CHECK:
--   pending:  reviewed_by, reviewed_at, rejection_reason all NULL
--   approved: reviewed_by AND reviewed_at NOT NULL; rejection_reason NULL
--   rejected: reviewed_by AND reviewed_at AND rejection_reason NOT NULL
--
-- new_rsvp_status MUST differ from old_rsvp_status (no no-op
-- requests). Reviewer must belong to the same tenant (4-way
-- tenant-match trigger).

CREATE TABLE rsvp_change_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id          uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id          uuid        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  old_rsvp_status   text        NOT NULL CHECK (old_rsvp_status IN ('pending','attending','not_attending','tentative')),
  new_rsvp_status   text        NOT NULL CHECK (new_rsvp_status IN ('pending','attending','not_attending','tentative')),
  reason            text        CHECK (reason IS NULL OR length(reason) <= 2000),
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by       uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  rejection_reason  text        CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 2000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (new_rsvp_status <> old_rsvp_status),
  CHECK (status <> 'pending' OR (reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)),
  CHECK (status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)),
  CHECK (status <> 'rejected' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL)),
  CHECK (reviewed_at IS NULL OR reviewed_at >= created_at)
);

CREATE INDEX idx_rsvp_changes_event    ON rsvp_change_requests (event_id, status);
CREATE INDEX idx_rsvp_changes_tenant   ON rsvp_change_requests (tenant_id);
CREATE INDEX idx_rsvp_changes_guest    ON rsvp_change_requests (guest_id);
CREATE INDEX idx_rsvp_changes_reviewer ON rsvp_change_requests (reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX idx_rsvp_changes_pending  ON rsvp_change_requests (event_id, created_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION rsvp_change_requests_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; guest_tenant uuid; guest_event uuid; reviewer_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  SELECT tenant_id, event_id INTO guest_tenant, guest_event FROM guests WHERE id = NEW.guest_id;
  IF event_tenant IS NULL OR guest_tenant IS NULL THEN
    RAISE EXCEPTION 'rsvp_change_requests parent rows not found' USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id OR guest_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'rsvp_change_requests.tenant_id % does not match event/guest tenants', NEW.tenant_id USING ERRCODE = '23514';
  END IF;
  IF guest_event <> NEW.event_id THEN
    RAISE EXCEPTION 'rsvp_change_requests.guest_id % belongs to event %, not %', NEW.guest_id, guest_event, NEW.event_id USING ERRCODE = '23514';
  END IF;
  IF NEW.reviewed_by IS NOT NULL THEN
    SELECT tenant_id INTO reviewer_tenant FROM tenant_members WHERE id = NEW.reviewed_by;
    IF reviewer_tenant IS NULL OR reviewer_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'rsvp_change_requests.reviewed_by % does not belong to tenant %', NEW.reviewed_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rsvp_change_requests_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, guest_id, reviewed_by ON rsvp_change_requests
  FOR EACH ROW EXECUTE FUNCTION rsvp_change_requests_check_tenant_match();

ALTER TABLE rsvp_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvp_change_requests FORCE ROW LEVEL SECURITY;
