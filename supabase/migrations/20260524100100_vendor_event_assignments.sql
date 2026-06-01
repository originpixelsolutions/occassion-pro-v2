-- Phase 3 Unit 21: vendor_event_assignments (spec lines 2004-2025).
-- Per-event vendor assignment with invitation/response lifecycle.
-- Status state machine: invited -> accepted | declined |
-- cancelled, then accepted -> completed.
--
-- Per-state prereq CHECKs:
--   accepted  : responded_at NOT NULL
--   declined  : responded_at AND declined_reason NOT NULL
--   cancelled : cancelled_at AND cancelled_reason NOT NULL
--   completed : completed_at NOT NULL
--   rating    : performance_rating only allowed when status='completed'
--
-- contract_value paired with currency_code (ISO 4217). Partial
-- UNIQUE on (vendor_account_id, event_id, lower(service_category))
-- WHERE deleted_at IS NULL - the same vendor can't be double-
-- assigned to the same service category on the same event, but
-- soft-deleted rows don't block re-assignment.
--
-- Cross-tenant trigger: event.tenant_id must equal assignment
-- tenant; assigned_by member must belong to same tenant.

CREATE TABLE vendor_event_assignments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id   uuid        NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  service_category    text        NOT NULL CHECK (length(trim(service_category)) BETWEEN 1 AND 60),
  status              text        NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','accepted','declined','completed','cancelled')),
  contract_value      numeric(14,2) CHECK (contract_value IS NULL OR contract_value >= 0),
  currency_code       varchar(3)  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  assigned_by         uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  assigned_at         timestamptz NOT NULL DEFAULT now(),
  responded_at        timestamptz,
  declined_reason     text        CHECK (declined_reason IS NULL OR length(declined_reason) <= 2000),
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancelled_reason    text        CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  performance_rating  numeric(2,1) CHECK (performance_rating IS NULL OR (performance_rating >= 1.0 AND performance_rating <= 5.0)),
  performance_notes   text        CHECK (performance_notes IS NULL OR length(performance_notes) <= 4000),
  deleted_at          timestamptz,
  purge_after         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((contract_value IS NULL) = (currency_code IS NULL)),
  CHECK (status <> 'accepted'  OR responded_at IS NOT NULL),
  CHECK (status <> 'declined'  OR (responded_at IS NOT NULL AND declined_reason IS NOT NULL)),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
  CHECK (performance_rating IS NULL OR status = 'completed'),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_vendor_event_assignments_active
  ON vendor_event_assignments (vendor_account_id, event_id, lower(service_category))
  WHERE deleted_at IS NULL;

CREATE INDEX idx_vendor_assignments_vendor   ON vendor_event_assignments (vendor_account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_assignments_event    ON vendor_event_assignments (event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_assignments_tenant   ON vendor_event_assignments (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_assignments_status   ON vendor_event_assignments (event_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_assignments_assigner ON vendor_event_assignments (assigned_by) WHERE assigned_by IS NOT NULL;
CREATE INDEX idx_vendor_assignments_purge    ON vendor_event_assignments (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION vendor_event_assignments_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; assigner_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'vendor_event_assignments.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'vendor_event_assignments.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  IF NEW.assigned_by IS NOT NULL THEN
    SELECT tenant_id INTO assigner_tenant FROM tenant_members WHERE id = NEW.assigned_by;
    IF assigner_tenant IS NULL OR assigner_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'vendor_event_assignments.assigned_by % does not belong to tenant %', NEW.assigned_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_event_assignments_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, assigned_by ON vendor_event_assignments
  FOR EACH ROW EXECUTE FUNCTION vendor_event_assignments_check_tenant_match();

ALTER TABLE vendor_event_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_event_assignments FORCE ROW LEVEL SECURITY;
