-- Phase 2 Unit 13: tenant_invoice_recipients (spec 3.14.3).
-- Finance / AP / CEO emails that receive billing communications.
-- At least one channel must be enabled. Soft-delete via removed_at.

CREATE TABLE tenant_invoice_recipients (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email            citext      NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  name             text        CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 120),
  role             text        CHECK (role IS NULL OR role IN ('finance','accounts_payable','ceo','operations','admin','other')),
  receive_invoices boolean     NOT NULL DEFAULT TRUE,
  receive_receipts boolean     NOT NULL DEFAULT TRUE,
  receive_dunning  boolean     NOT NULL DEFAULT TRUE,
  added_by         uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz,
  CHECK (receive_invoices OR receive_receipts OR receive_dunning)
);

CREATE INDEX idx_invoice_recipients_tenant   ON tenant_invoice_recipients (tenant_id) WHERE removed_at IS NULL;
CREATE INDEX idx_invoice_recipients_added_by ON tenant_invoice_recipients (added_by)  WHERE added_by IS NOT NULL;

CREATE UNIQUE INDEX uq_invoice_recipients_email_active
  ON tenant_invoice_recipients (tenant_id, email)
  WHERE removed_at IS NULL;

ALTER TABLE tenant_invoice_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invoice_recipients FORCE ROW LEVEL SECURITY;
