-- Phase 6 Unit 47: vendor_payouts (spec 17.3 line 3091).
-- Per-event vendor payouts with milestone, status state
-- machine, and gateway dispatch. Six-state lifecycle:
--   scheduled -> approved -> disbursing -> disbursed
--             -> failed
--             -> cancelled
--
-- Per-state prereq CHECKs:
--   approved   : approved_at AND approved_by NOT NULL
--   disbursing : adds gateway NOT NULL (chosen at approval)
--   disbursed  : approved_at AND disbursed_at AND gateway
--   failed     : failed_at AND failure_reason NOT NULL
--   cancelled  : cancelled_at AND cancelled_reason NOT NULL
-- Plus disbursed_at >= approved_at when set.
--
-- milestone is free-text (the human label) and milestone_type
-- is an optional enum for analytics (booking_advance,
-- progress, final, retainer, expense_reimbursement, bonus,
-- other). amount > 0 (zero/negative payouts make no sense).
-- net_amount GENERATED ALWAYS AS (amount - COALESCE(fees, 0))
-- STORED for fast settlement queries.
--
-- gateway enum (6 values) matches the spec's three rails plus
-- manual/bank_transfer/cheque for offline workflows.
-- bank_account_last4 (4 digits) and ifsc_code (Indian bank
-- routing, ^[A-Z]{4}0[A-Z0-9]{6}$) are captured at payout
-- time so we have an audit trail even if the vendor's profile
-- changes later.
--
-- Partial UNIQUE (gateway, gateway_payout_id) WHERE NOT NULL
-- so the gateway webhook can idempotently upsert.
--
-- Five-way tenant-match trigger: event + assignment (which
-- also asserts the assignment's vendor matches when both are
-- set) + approved_by + created_by member all belong to the
-- payout's tenant.

CREATE TABLE vendor_payouts (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            uuid          REFERENCES events(id) ON DELETE CASCADE,
  vendor_account_id   uuid          REFERENCES vendor_accounts(id) ON DELETE SET NULL,
  assignment_id       uuid          REFERENCES vendor_event_assignments(id) ON DELETE SET NULL,
  milestone           text          NOT NULL CHECK (length(trim(milestone)) BETWEEN 1 AND 200),
  milestone_type      text          CHECK (milestone_type IS NULL OR milestone_type IN ('booking_advance','progress','final','retainer','expense_reimbursement','bonus','other')),
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code       varchar(3)    NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  fees                numeric(14,2) CHECK (fees IS NULL OR fees >= 0),
  net_amount          numeric(14,2) GENERATED ALWAYS AS (amount - COALESCE(fees, 0)) STORED,
  scheduled_for       timestamptz,
  status              text          NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','approved','disbursing','disbursed','failed','cancelled')),
  gateway             text          CHECK (gateway IS NULL OR gateway IN ('razorpay_x','stripe_connect','cashfree_payout','manual','bank_transfer','cheque')),
  gateway_payout_id   text          CHECK (gateway_payout_id IS NULL OR length(gateway_payout_id) BETWEEN 1 AND 256),
  gateway_utr         text          CHECK (gateway_utr IS NULL OR length(gateway_utr) BETWEEN 1 AND 100),
  bank_account_last4  text          CHECK (bank_account_last4 IS NULL OR bank_account_last4 ~ '^[0-9]{4}$'),
  ifsc_code           text          CHECK (ifsc_code IS NULL OR ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  approved_by         uuid          REFERENCES tenant_members(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  disbursed_at        timestamptz,
  failed_at           timestamptz,
  failure_reason      text          CHECK (failure_reason IS NULL OR length(failure_reason) <= 2000),
  cancelled_at        timestamptz,
  cancelled_reason    text          CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  notes               text          CHECK (notes IS NULL OR length(notes) <= 4000),
  metadata            jsonb         CHECK (metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) < 32768)),
  created_by          uuid          REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  purge_after         timestamptz,
  CHECK (status <> 'approved'   OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CHECK (status <> 'disbursing' OR (approved_at IS NOT NULL AND gateway IS NOT NULL)),
  CHECK (status <> 'disbursed'  OR (approved_at IS NOT NULL AND disbursed_at IS NOT NULL AND gateway IS NOT NULL)),
  CHECK (status <> 'failed'     OR (failed_at IS NOT NULL AND failure_reason IS NOT NULL)),
  CHECK (status <> 'cancelled'  OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
  CHECK (disbursed_at IS NULL OR (approved_at IS NOT NULL AND disbursed_at >= approved_at)),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_vendor_payouts_gateway
  ON vendor_payouts (gateway, gateway_payout_id) WHERE gateway_payout_id IS NOT NULL;

CREATE INDEX idx_payouts_event             ON vendor_payouts (event_id) WHERE event_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payouts_vendor            ON vendor_payouts (vendor_account_id) WHERE vendor_account_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payouts_tenant            ON vendor_payouts (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payouts_assignment        ON vendor_payouts (assignment_id) WHERE assignment_id IS NOT NULL;
CREATE INDEX idx_payouts_status_scheduled  ON vendor_payouts (status, scheduled_for) WHERE status IN ('scheduled','approved') AND deleted_at IS NULL;
CREATE INDEX idx_payouts_approver          ON vendor_payouts (approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX idx_payouts_due               ON vendor_payouts (scheduled_for) WHERE status = 'scheduled' AND deleted_at IS NULL;
CREATE INDEX idx_payouts_purge             ON vendor_payouts (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION vendor_payouts_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; ass_tenant uuid; ass_event uuid; ass_vendor uuid;
        approver_tenant uuid; creator_tenant uuid;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
    IF event_tenant IS NULL THEN
      RAISE EXCEPTION 'vendor_payouts.event_id % not found', NEW.event_id USING ERRCODE = '23503';
    END IF;
    IF event_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'vendor_payouts.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.assignment_id IS NOT NULL THEN
    SELECT tenant_id, event_id, vendor_account_id INTO ass_tenant, ass_event, ass_vendor FROM vendor_event_assignments WHERE id = NEW.assignment_id;
    IF ass_tenant IS NULL THEN
      RAISE EXCEPTION 'vendor_payouts.assignment_id % not found', NEW.assignment_id USING ERRCODE = '23503';
    END IF;
    IF ass_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'vendor_payouts.tenant_id % does not match assignment tenant %', NEW.tenant_id, ass_tenant USING ERRCODE = '23514';
    END IF;
    IF NEW.event_id IS NOT NULL AND ass_event <> NEW.event_id THEN
      RAISE EXCEPTION 'vendor_payouts.assignment % belongs to event %, not %', NEW.assignment_id, ass_event, NEW.event_id USING ERRCODE = '23514';
    END IF;
    IF NEW.vendor_account_id IS NOT NULL AND ass_vendor <> NEW.vendor_account_id THEN
      RAISE EXCEPTION 'vendor_payouts.assignment vendor % does not match vendor_account_id %', ass_vendor, NEW.vendor_account_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.approved_by IS NOT NULL THEN
    SELECT tenant_id INTO approver_tenant FROM tenant_members WHERE id = NEW.approved_by;
    IF approver_tenant IS NULL OR approver_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'vendor_payouts.approved_by % does not belong to tenant %', NEW.approved_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'vendor_payouts.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_payouts_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, assignment_id, vendor_account_id, approved_by, created_by ON vendor_payouts
  FOR EACH ROW EXECUTE FUNCTION vendor_payouts_check_tenant_match();

ALTER TABLE vendor_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_payouts FORCE ROW LEVEL SECURITY;
