-- Phase 6 Unit 45: invoices (spec 17.2 line 3059).
-- GST-compliant invoices. Eight-state machine:
--   draft -> sent -> viewed -> paid (partially_paid)
--                 -> overdue
--                 -> cancelled
--                 -> refunded
--
-- Per-state prereq CHECKs gate every transition - 'sent'
-- requires issued_at AND sent_at NOT NULL; 'paid' requires
-- paid_at NOT NULL AND amount_paid = grand_total;
-- 'partially_paid' requires 0 < amount_paid < grand_total;
-- 'overdue' requires due_at NOT NULL; 'cancelled' requires
-- cancelled_at AND cancelled_reason NOT NULL.
--
-- Money invariants enforced at the row level:
--   grand_total = subtotal + tax_total - discount_total
--   amount_paid <= grand_total
--   amount_outstanding is GENERATED ALWAYS AS (grand_total
--     - amount_paid) STORED so the AR queries don't have to
--     compute it
--
-- GSTIN regex matches the canonical Indian format:
--   ^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$
-- (2-digit state code, 10-char PAN, entity code, Z literal,
-- check digit). currency_code ISO-4217 ^[A-Z]{3}$.
--
-- line_items jsonb MUST be an array (per accounting convention,
-- line by line), 1-500 items, <512 KiB total. tax_breakdown
-- jsonb (CGST/SGST/IGST/cess split) MUST be an object,
-- <32 KiB. invoice_number regex matches alphanumeric + slash/
-- hyphen/underscore (INV-2026/01-001 etc).
--
-- Spec-mandated UNIQUE (tenant_id, invoice_number).
-- Cross-tenant trigger validates event + created_by member.

CREATE TABLE invoices (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id          uuid          REFERENCES events(id) ON DELETE CASCADE,
  client_account_id uuid          REFERENCES client_accounts(id) ON DELETE SET NULL,
  invoice_number    text          NOT NULL CHECK (length(trim(invoice_number)) BETWEEN 1 AND 50 AND invoice_number ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,48}[A-Za-z0-9]$'),
  bill_to_name      text          NOT NULL CHECK (length(trim(bill_to_name)) BETWEEN 1 AND 200),
  bill_to_email     citext        CHECK (bill_to_email IS NULL OR (bill_to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(bill_to_email) <= 254)),
  bill_to_address   text          CHECK (bill_to_address IS NULL OR length(bill_to_address) <= 2000),
  bill_to_phone     text          CHECK (bill_to_phone IS NULL OR bill_to_phone ~ '^\+[1-9][0-9]{6,14}$'),
  bill_to_gstin     text          CHECK (bill_to_gstin IS NULL OR bill_to_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$'),
  bill_to_country   varchar(2)    CHECK (bill_to_country IS NULL OR bill_to_country ~ '^[A-Z]{2}$'),
  line_items        jsonb         NOT NULL CHECK (jsonb_typeof(line_items) = 'array' AND jsonb_array_length(line_items) BETWEEN 1 AND 500 AND pg_column_size(line_items) < 524288),
  subtotal          numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total         numeric(14,2) NOT NULL CHECK (tax_total >= 0),
  discount_total    numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  grand_total       numeric(14,2) NOT NULL CHECK (grand_total >= 0),
  amount_paid       numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_outstanding numeric(14,2) GENERATED ALWAYS AS (grand_total - amount_paid) STORED,
  currency_code     varchar(3)    NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  tax_breakdown     jsonb         CHECK (tax_breakdown IS NULL OR (jsonb_typeof(tax_breakdown) = 'object' AND pg_column_size(tax_breakdown) < 32768)),
  status            text          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','paid','partially_paid','overdue','cancelled','refunded')),
  issued_at         timestamptz,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  due_at            timestamptz,
  paid_at           timestamptz,
  cancelled_at      timestamptz,
  cancelled_reason  text          CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  pdf_url           text          CHECK (pdf_url IS NULL OR (pdf_url ~ '^https://' AND length(pdf_url) BETWEEN 1 AND 2048)),
  pdf_r2_key        text          CHECK (pdf_r2_key IS NULL OR length(pdf_r2_key) BETWEEN 1 AND 1024),
  notes             text          CHECK (notes IS NULL OR length(notes) <= 8000),
  terms             text          CHECK (terms IS NULL OR length(terms) <= 8000),
  created_by        uuid          REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  purge_after       timestamptz,
  CHECK (grand_total = subtotal + tax_total - discount_total),
  CHECK (amount_paid <= grand_total),
  CHECK (status <> 'sent'            OR (issued_at IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (status <> 'viewed'          OR (sent_at IS NOT NULL AND viewed_at IS NOT NULL)),
  CHECK (status <> 'paid'            OR (paid_at IS NOT NULL AND amount_paid = grand_total)),
  CHECK (status <> 'partially_paid'  OR (amount_paid > 0 AND amount_paid < grand_total)),
  CHECK (status <> 'overdue'         OR (due_at IS NOT NULL)),
  CHECK (status <> 'cancelled'       OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
  CHECK (due_at IS NULL OR issued_at IS NULL OR due_at >= issued_at),
  CHECK (paid_at IS NULL OR issued_at IS NULL OR paid_at >= issued_at),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL),
  UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX idx_invoices_event       ON invoices (event_id) WHERE event_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_invoices_tenant      ON invoices (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_client      ON invoices (client_account_id) WHERE client_account_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_invoices_status      ON invoices (tenant_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_due         ON invoices (due_at) WHERE status IN ('sent','viewed','partially_paid','overdue') AND deleted_at IS NULL;
CREATE INDEX idx_invoices_outstanding ON invoices (tenant_id, amount_outstanding DESC) WHERE amount_outstanding > 0 AND deleted_at IS NULL;
CREATE INDEX idx_invoices_creator     ON invoices (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_invoices_purge_due   ON invoices (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION invoices_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; creator_tenant uuid;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
    IF event_tenant IS NULL THEN
      RAISE EXCEPTION 'invoices.event_id % not found', NEW.event_id USING ERRCODE = '23503';
    END IF;
    IF event_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'invoices.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'invoices.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoices_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, created_by ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_check_tenant_match();

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

-- Resolve Phase 1 forward-FK debt now that invoices exists.
ALTER TABLE revenue_recognition_entries
  ADD CONSTRAINT revenue_recognition_entries_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE dunning_events
  ADD CONSTRAINT dunning_events_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_revenue_recognition_entries_invoice ON revenue_recognition_entries (invoice_id);
CREATE INDEX IF NOT EXISTS idx_dunning_events_invoice              ON dunning_events (invoice_id);
