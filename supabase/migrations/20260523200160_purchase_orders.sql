-- Phase 2 Unit 33: purchase_orders (spec 3.14.4).
-- Enterprise PO billing. status:
--   pending_review -> approved -> active -> exhausted | expired | cancelled
-- amount_consumed <= po_amount enforced at the DB. UNIQUE (tenant, po_number).

CREATE TABLE purchase_orders (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  po_number         text          NOT NULL CHECK (length(trim(po_number)) BETWEEN 1 AND 120),
  po_amount         numeric(14,2) NOT NULL CHECK (po_amount > 0),
  po_currency       varchar(3)    NOT NULL CHECK (po_currency ~ '^[A-Z]{3}$'),
  po_issued_date    date,
  po_expires_date   date,
  po_document_url   text          CHECK (po_document_url IS NULL OR po_document_url ~ '^https://'),
  approved_by_admin uuid          REFERENCES super_admins (id) ON DELETE SET NULL,
  approved_at       timestamptz,
  status            text          NOT NULL DEFAULT 'pending_review' CHECK (status IN (
                                    'pending_review','approved','active','exhausted','expired','cancelled'
                                  )),
  amount_consumed   numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_consumed >= 0),
  notes             text          CHECK (notes IS NULL OR length(notes) <= 4000),
  cancelled_at      timestamptz,
  cancelled_by      uuid          REFERENCES super_admins (id) ON DELETE SET NULL,
  cancelled_reason  text          CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, po_number),
  CHECK (po_expires_date IS NULL OR po_issued_date IS NULL OR po_expires_date > po_issued_date),
  CHECK (amount_consumed <= po_amount),
  CHECK ((approved_at IS NULL) = (approved_by_admin IS NULL)),
  CHECK (status NOT IN ('active','exhausted','expired') OR (approved_at IS NOT NULL AND approved_by_admin IS NOT NULL)),
  CHECK (status <> 'exhausted' OR amount_consumed = po_amount),
  CHECK (status <> 'expired'   OR (po_expires_date IS NOT NULL AND po_expires_date < CURRENT_DATE + 1)),
  CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL))
);

CREATE INDEX idx_po_tenant         ON purchase_orders (tenant_id, status);
CREATE INDEX idx_po_active         ON purchase_orders (tenant_id) WHERE status = 'active';
CREATE INDEX idx_po_expiring       ON purchase_orders (po_expires_date) WHERE status = 'active' AND po_expires_date IS NOT NULL;
CREATE INDEX idx_po_approved_admin ON purchase_orders (approved_by_admin) WHERE approved_by_admin IS NOT NULL;

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
