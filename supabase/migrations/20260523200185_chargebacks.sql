-- Phase 2 Unit 38: chargebacks (spec 3.14.9).
-- Razorpay/Stripe chargeback workflow. State machine:
--   received -> evidence_required -> evidence_submitted -> won|lost|accepted
-- UNIQUE (gateway, gateway_dispute_id) gives idempotent webhook handling.
-- payment_id FK lands in Phase 6 (payments).

CREATE TABLE chargebacks (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  payment_id            uuid,
  gateway               text          NOT NULL CHECK (gateway IN ('razorpay','stripe')),
  gateway_dispute_id    text          NOT NULL CHECK (length(trim(gateway_dispute_id)) BETWEEN 1 AND 200),
  amount                numeric(14,2) NOT NULL CHECK (amount > 0),
  currency_code         varchar(3)    NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  reason_code           text          CHECK (reason_code IS NULL OR length(trim(reason_code)) BETWEEN 1 AND 120),
  reason_description    text          CHECK (reason_description IS NULL OR length(reason_description) <= 4000),
  status                text          NOT NULL DEFAULT 'received' CHECK (status IN (
                                        'received','evidence_required','evidence_submitted','won','lost','accepted'
                                      )),
  evidence_due_by       timestamptz,
  evidence_submitted_at timestamptz,
  evidence_files        jsonb         CHECK (evidence_files IS NULL OR jsonb_typeof(evidence_files) = 'array'),
  resolution_at         timestamptz,
  account_action        text          NOT NULL DEFAULT 'none' CHECK (account_action IN ('none','warning','frozen','suspended','terminated')),
  notes                 text          CHECK (notes IS NULL OR length(notes) <= 4000),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (gateway, gateway_dispute_id),
  CHECK (status <> 'evidence_submitted' OR (evidence_submitted_at IS NOT NULL AND evidence_files IS NOT NULL)),
  CHECK (status NOT IN ('won','lost','accepted') OR resolution_at IS NOT NULL),
  CHECK (evidence_submitted_at IS NULL OR evidence_submitted_at >= created_at),
  CHECK (resolution_at         IS NULL OR resolution_at         >= created_at)
);

CREATE INDEX idx_chargebacks_tenant      ON chargebacks (tenant_id);
CREATE INDEX idx_chargebacks_gateway_id  ON chargebacks (gateway, gateway_dispute_id);
CREATE INDEX idx_chargebacks_payment     ON chargebacks (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_chargebacks_pending     ON chargebacks (evidence_due_by) WHERE status IN ('received','evidence_required');
CREATE INDEX idx_chargebacks_recent_lost ON chargebacks (tenant_id, created_at) WHERE status = 'lost';

ALTER TABLE chargebacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chargebacks FORCE ROW LEVEL SECURITY;
