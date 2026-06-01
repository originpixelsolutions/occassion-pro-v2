-- Phase 3 Unit 40: vendor_crew_assignments (spec line 2077).
-- Per-event assignment of a vendor crew member to their
-- vendor's event assignment. State machine:
--   scheduled -> confirmed -> checked_in -> checked_out
--             -> no_show
--             -> cancelled
--
-- Per-state prereq CHECKs:
--   checked_in  : checked_in_at NOT NULL
--   checked_out : both timestamps NOT NULL and ordered
--   cancelled   : cancelled_at AND cancelled_reason NOT NULL
-- Plus shift_end > shift_start when both set.
--
-- role_on_event is a free-text override (the crew member's
-- main role lives on vendor_crew_members.role; on a given
-- event they might play a different role). hourly_rate_override
-- lets the vendor pay differently for this event without
-- mutating the member's profile.
--
-- Carries vendor_account_id, tenant_id, event_id denormalized
-- alongside the FKs so the conflict-detection / shift-overlap
-- queries don't need a join through vendor_event_assignments.
--
-- Five-way tenant-match trigger: vendor_assignment (tenant +
-- event + vendor) and crew_member (vendor) must all match the
-- row's columns. Per spec, UNIQUE (vendor_assignment_id,
-- crew_member_id) blocks the same crew on the same assignment.

CREATE TABLE vendor_crew_assignments (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_assignment_id uuid          NOT NULL REFERENCES vendor_event_assignments(id) ON DELETE CASCADE,
  crew_member_id       uuid          NOT NULL REFERENCES vendor_crew_members(id) ON DELETE CASCADE,
  vendor_account_id    uuid          NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  tenant_id            uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id             uuid          NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role_on_event        text          CHECK (role_on_event IS NULL OR length(trim(role_on_event)) BETWEEN 1 AND 100),
  shift_start          timestamptz,
  shift_end            timestamptz,
  hourly_rate_override numeric(10,2) CHECK (hourly_rate_override IS NULL OR hourly_rate_override >= 0),
  status               text          NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','checked_in','checked_out','no_show','cancelled')),
  checked_in_at        timestamptz,
  checked_out_at       timestamptz,
  cancelled_at         timestamptz,
  cancelled_reason     text          CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 1000),
  notes                text          CHECK (notes IS NULL OR length(notes) <= 4000),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  CHECK (shift_end IS NULL OR shift_start IS NULL OR shift_end > shift_start),
  CHECK (status <> 'checked_in'  OR checked_in_at IS NOT NULL),
  CHECK (status <> 'checked_out' OR (checked_in_at IS NOT NULL AND checked_out_at IS NOT NULL AND checked_out_at >= checked_in_at)),
  CHECK (status <> 'cancelled'   OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL))
);

CREATE UNIQUE INDEX uq_vendor_crew_assignments
  ON vendor_crew_assignments (vendor_assignment_id, crew_member_id);

CREATE INDEX idx_vendor_crew_assign_event     ON vendor_crew_assignments (vendor_assignment_id);
CREATE INDEX idx_vendor_crew_assign_member    ON vendor_crew_assignments (crew_member_id);
CREATE INDEX idx_vendor_crew_assign_vendor    ON vendor_crew_assignments (vendor_account_id);
CREATE INDEX idx_vendor_crew_assign_tenant    ON vendor_crew_assignments (tenant_id);
CREATE INDEX idx_vendor_crew_assign_event_evt ON vendor_crew_assignments (event_id);
CREATE INDEX idx_vendor_crew_assign_status    ON vendor_crew_assignments (event_id, status);
CREATE INDEX idx_vendor_crew_assign_shift     ON vendor_crew_assignments (vendor_account_id, shift_start, shift_end) WHERE shift_start IS NOT NULL;

CREATE OR REPLACE FUNCTION vendor_crew_assignments_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE va_tenant uuid; va_event uuid; va_vendor uuid; cm_vendor uuid;
BEGIN
  SELECT tenant_id, event_id, vendor_account_id INTO va_tenant, va_event, va_vendor FROM vendor_event_assignments WHERE id = NEW.vendor_assignment_id;
  IF va_tenant IS NULL THEN
    RAISE EXCEPTION 'vendor_crew_assignments.vendor_assignment_id % not found', NEW.vendor_assignment_id USING ERRCODE = '23503';
  END IF;
  IF va_tenant <> NEW.tenant_id OR va_event <> NEW.event_id OR va_vendor <> NEW.vendor_account_id THEN
    RAISE EXCEPTION 'vendor_crew_assignments parents (tenant=%, event=%, vendor=%) do not match (%, %, %)',
      va_tenant, va_event, va_vendor, NEW.tenant_id, NEW.event_id, NEW.vendor_account_id USING ERRCODE = '23514';
  END IF;
  SELECT vendor_account_id INTO cm_vendor FROM vendor_crew_members WHERE id = NEW.crew_member_id;
  IF cm_vendor IS NULL THEN
    RAISE EXCEPTION 'vendor_crew_assignments.crew_member_id % not found', NEW.crew_member_id USING ERRCODE = '23503';
  END IF;
  IF cm_vendor <> NEW.vendor_account_id THEN
    RAISE EXCEPTION 'vendor_crew_assignments.crew_member % does not belong to vendor %', NEW.crew_member_id, NEW.vendor_account_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_crew_assignments_tenant_match
  BEFORE INSERT OR UPDATE OF vendor_assignment_id, crew_member_id, vendor_account_id, tenant_id, event_id ON vendor_crew_assignments
  FOR EACH ROW EXECUTE FUNCTION vendor_crew_assignments_check_tenant_match();

ALTER TABLE vendor_crew_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_crew_assignments FORCE ROW LEVEL SECURITY;
