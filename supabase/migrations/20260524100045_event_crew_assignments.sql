-- Phase 3 Unit 10: event_crew_assignments (spec 8.5).
-- Per-event crew assignments. 6-state machine with per-state prereqs.
-- Payment coupling. Partial UNIQUE one active assignment per (event,
-- crew). Trigger blocks cross-tenant assignment.

CREATE TABLE event_crew_assignments (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_id             uuid          NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  crew_id              uuid          NOT NULL REFERENCES crew_pool (id) ON DELETE CASCADE,
  role_on_event        text          CHECK (role_on_event IS NULL OR length(trim(role_on_event)) BETWEEN 1 AND 120),
  shift_start          timestamptz   NOT NULL,
  shift_end            timestamptz   NOT NULL,
  hourly_rate_override numeric(10,2) CHECK (hourly_rate_override IS NULL OR hourly_rate_override >= 0),
  hours_worked         numeric(5,2)  CHECK (hours_worked IS NULL OR (hours_worked >= 0 AND hours_worked <= 168)),
  status               text          NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','checked_in','checked_out','no_show','cancelled')),
  check_in_at          timestamptz,
  check_out_at         timestamptz,
  total_payable        numeric(14,2) CHECK (total_payable IS NULL OR total_payable >= 0),
  currency_code        varchar(3)    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  paid_at              timestamptz,
  payment_method       text          CHECK (payment_method IS NULL OR payment_method IN ('cash','upi','bank_transfer','razorpay_x','stripe','other')),
  payment_reference    text          CHECK (payment_reference IS NULL OR length(trim(payment_reference)) BETWEEN 1 AND 200),
  cancelled_at         timestamptz,
  cancelled_reason     text          CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  notes                text          CHECK (notes IS NULL OR length(notes) <= 4000),
  assigned_by          uuid          REFERENCES tenant_members (id) ON DELETE SET NULL,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  CHECK (shift_end > shift_start),
  CHECK (status <> 'checked_in'  OR check_in_at  IS NOT NULL),
  CHECK (status <> 'checked_out' OR (check_in_at IS NOT NULL AND check_out_at IS NOT NULL AND hours_worked IS NOT NULL)),
  CHECK (status <> 'cancelled'   OR cancelled_at IS NOT NULL),
  CHECK (check_out_at IS NULL OR check_in_at IS NOT NULL),
  CHECK (check_out_at IS NULL OR check_out_at >= check_in_at),
  CHECK ((paid_at IS NULL  AND payment_method IS NULL)
      OR (paid_at IS NOT NULL AND payment_method IS NOT NULL AND total_payable IS NOT NULL AND currency_code IS NOT NULL))
);

CREATE UNIQUE INDEX uq_crew_assign_active
  ON event_crew_assignments (event_id, crew_id) WHERE status <> 'cancelled';

CREATE INDEX idx_crew_assign_event  ON event_crew_assignments (event_id);
CREATE INDEX idx_crew_assign_crew   ON event_crew_assignments (crew_id);
CREATE INDEX idx_crew_assign_shift  ON event_crew_assignments (shift_start, shift_end);
CREATE INDEX idx_crew_assign_tenant ON event_crew_assignments (tenant_id, shift_start);
CREATE INDEX idx_crew_assign_unpaid ON event_crew_assignments (tenant_id) WHERE paid_at IS NULL AND status = 'checked_out';

CREATE OR REPLACE FUNCTION trg_event_crew_assignments_tenant_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; crew_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events    WHERE id = NEW.event_id;
  SELECT tenant_id INTO crew_tenant  FROM crew_pool WHERE id = NEW.crew_id;
  IF event_tenant IS NULL OR event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'event_crew_assignments_event_tenant_mismatch: event tenant (%) <> assignment tenant (%)',
                    event_tenant, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF crew_tenant IS NULL OR crew_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'event_crew_assignments_crew_tenant_mismatch: crew tenant (%) <> assignment tenant (%)',
                    crew_tenant, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_crew_assignments_tenant_match
BEFORE INSERT OR UPDATE OF tenant_id, event_id, crew_id ON event_crew_assignments
FOR EACH ROW EXECUTE FUNCTION trg_event_crew_assignments_tenant_match();

ALTER TABLE event_crew_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_crew_assignments FORCE ROW LEVEL SECURITY;
