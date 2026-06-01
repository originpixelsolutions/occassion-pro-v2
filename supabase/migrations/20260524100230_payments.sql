-- Phase 6 Unit 46: payments (spec 17.x line 3029).
-- Payment records tied to invoices via FK. Seven-state
-- machine: pending -> authorized -> succeeded ->
-- refunded|partially_refunded; or failed, cancelled.
--
-- Per-state prereq CHECKs:
--   authorized        : authorized_at NOT NULL
--   succeeded         : paid_at NOT NULL
--   failed            : failed_at AND failure_reason NOT NULL
--   refunded          : refunded_at NOT NULL AND
--                       refunded_amount = amount
--   partially_refunded: refunded_at AND 0 < refunded_amount
--                       < amount
--   cancelled         : cancelled_at AND cancelled_reason
--                       NOT NULL
--
-- payer_type enum supports six payer kinds (client, guest,
-- sponsor, exhibitor, tenant_subscription, other). payer_id is
-- intentionally a polymorphic FK without referential
-- enforcement (different payer_types resolve to different
-- target tables - tenant_subscription resolves to none).
--
-- Money invariants:
--   amount > 0
--   refunded_amount <= amount
--   net_amount GENERATED ALWAYS AS (amount - COALESCE(fees,0)
--     - refunded_amount) STORED for fast tenant settlement
--     queries
--
-- Gateway enum expanded from spec to include all Indian and
-- Western rails: razorpay, stripe, cashfree, paytm, manual,
-- bank_transfer, cheque, cash, other. payment_method enum
-- captures the user-facing method (card, upi, netbanking,
-- etc).
--
-- Partial UNIQUE (gateway, gateway_payment_id) WHERE NOT NULL:
-- the gateway's payment ID is unique within that gateway, so
-- webhooks can idempotently upsert without duplicates.
--
-- Cross-tenant trigger validates event + invoice (which must
-- belong to the same event when both are set) + created_by
-- member.

CREATE TABLE payments (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id           uuid          REFERENCES events(id) ON DELETE CASCADE,
  invoice_id         uuid          REFERENCES invoices(id) ON DELETE SET NULL,
  payer_type         text          NOT NULL CHECK (payer_type IN ('client','guest','sponsor','exhibitor','tenant_subscription','other')),
  payer_id           uuid,
  payer_name         text          CHECK (payer_name IS NULL OR length(trim(payer_name)) BETWEEN 1 AND 200),
  payer_email        citext        CHECK (payer_email IS NULL OR (payer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(payer_email) <= 254)),
  payer_phone        text          CHECK (payer_phone IS NULL OR payer_phone ~ '^\+[1-9][0-9]{6,14}$'),
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code      varchar(3)    NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  status             text          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','authorized','succeeded','failed','refunded','partially_refunded','cancelled')),
  gateway            text          NOT NULL CHECK (gateway IN ('razorpay','stripe','cashfree','paytm','manual','bank_transfer','cheque','cash','other')),
  gateway_payment_id text          CHECK (gateway_payment_id IS NULL OR length(gateway_payment_id) BETWEEN 1 AND 256),
  gateway_order_id   text          CHECK (gateway_order_id IS NULL OR length(gateway_order_id) BETWEEN 1 AND 256),
  gateway_signature  text          CHECK (gateway_signature IS NULL OR length(gateway_signature) BETWEEN 1 AND 512),
  payment_method     text          CHECK (payment_method IS NULL OR payment_method IN ('card','upi','netbanking','wallet','emi','paylater','bank_transfer','cheque','cash','other')),
  refunded_amount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  fees               numeric(14,2) CHECK (fees IS NULL OR fees >= 0),
  net_amount         numeric(14,2) GENERATED ALWAYS AS (amount - COALESCE(fees, 0) - refunded_amount) STORED,
  authorized_at      timestamptz,
  paid_at            timestamptz,
  failed_at          timestamptz,
  failure_reason     text          CHECK (failure_reason IS NULL OR length(failure_reason) <= 2000),
  refunded_at        timestamptz,
  refund_reason      text          CHECK (refund_reason IS NULL OR length(refund_reason) <= 2000),
  cancelled_at       timestamptz,
  cancelled_reason   text          CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  metadata           jsonb         CHECK (metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) < 32768)),
  ip_address         inet,
  created_by         uuid          REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  purge_after        timestamptz,
  CHECK (refunded_amount <= amount),
  CHECK (status <> 'authorized'         OR authorized_at IS NOT NULL),
  CHECK (status <> 'succeeded'          OR paid_at IS NOT NULL),
  CHECK (status <> 'failed'             OR (failed_at IS NOT NULL AND failure_reason IS NOT NULL)),
  CHECK (status <> 'refunded'           OR (refunded_at IS NOT NULL AND refunded_amount = amount)),
  CHECK (status <> 'partially_refunded' OR (refunded_at IS NOT NULL AND refunded_amount > 0 AND refunded_amount < amount)),
  CHECK (status <> 'cancelled'          OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
  CHECK (paid_at IS NULL OR paid_at >= created_at),
  CHECK (refunded_at IS NULL OR (paid_at IS NOT NULL AND refunded_at >= paid_at)),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_payments_gateway_payment
  ON payments (gateway, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;

CREATE INDEX idx_payments_event         ON payments (event_id) WHERE event_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payments_invoice       ON payments (invoice_id) WHERE invoice_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_payments_tenant        ON payments (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_gateway_order ON payments (gateway, gateway_order_id) WHERE gateway_order_id IS NOT NULL;
CREATE INDEX idx_payments_payer         ON payments (payer_type, payer_id) WHERE payer_id IS NOT NULL;
CREATE INDEX idx_payments_status_time   ON payments (tenant_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_pending       ON payments (created_at) WHERE status IN ('pending','authorized') AND deleted_at IS NULL;
CREATE INDEX idx_payments_email         ON payments (payer_email) WHERE payer_email IS NOT NULL;
CREATE INDEX idx_payments_purge         ON payments (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION payments_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; inv_tenant uuid; inv_event uuid; creator_tenant uuid;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
    IF event_tenant IS NULL THEN
      RAISE EXCEPTION 'payments.event_id % not found', NEW.event_id USING ERRCODE = '23503';
    END IF;
    IF event_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'payments.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT tenant_id, event_id INTO inv_tenant, inv_event FROM invoices WHERE id = NEW.invoice_id;
    IF inv_tenant IS NULL THEN
      RAISE EXCEPTION 'payments.invoice_id % not found', NEW.invoice_id USING ERRCODE = '23503';
    END IF;
    IF inv_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'payments.tenant_id % does not match invoice tenant %', NEW.tenant_id, inv_tenant USING ERRCODE = '23514';
    END IF;
    IF NEW.event_id IS NOT NULL AND inv_event IS NOT NULL AND inv_event <> NEW.event_id THEN
      RAISE EXCEPTION 'payments.invoice_id % belongs to event %, not %', NEW.invoice_id, inv_event, NEW.event_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'payments.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, invoice_id, created_by ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_check_tenant_match();

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

-- Resolve Phase 1 forward-FK debt: chargebacks.payment_id
ALTER TABLE chargebacks
  ADD CONSTRAINT chargebacks_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_chargebacks_payment ON chargebacks (payment_id);
