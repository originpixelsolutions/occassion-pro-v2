-- Phase 2 Unit 34: revenue_recognition_entries (spec 3.15).
-- Annual-prepay revenue recognition. recognized + deferred = total is
-- the bookkeeping invariant. Period in days drives the worker's monthly
-- straight-line accrual into revenue_recognition_monthly.
-- invoice_id FK lands in Phase 6 (invoices).

CREATE TABLE revenue_recognition_entries (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  invoice_id          uuid,
  amount_total        numeric(14,2) NOT NULL CHECK (amount_total > 0),
  amount_recognized   numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_recognized >= 0),
  amount_deferred     numeric(14,2) NOT NULL CHECK (amount_deferred >= 0),
  currency_code       varchar(3)    NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  period_start        date          NOT NULL,
  period_end          date          NOT NULL,
  recognition_method  text          NOT NULL DEFAULT 'straight_line' CHECK (recognition_method IN ('straight_line','milestone','immediate')),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (amount_recognized <= amount_total),
  CHECK (amount_deferred   <= amount_total),
  CHECK (amount_recognized + amount_deferred = amount_total)
);

CREATE INDEX idx_revrec_tenant        ON revenue_recognition_entries (tenant_id);
CREATE INDEX idx_revrec_period        ON revenue_recognition_entries (period_start, period_end);
CREATE INDEX idx_revrec_invoice       ON revenue_recognition_entries (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_revrec_currency      ON revenue_recognition_entries (currency_code);
CREATE INDEX idx_revrec_open_deferred ON revenue_recognition_entries (period_end) WHERE amount_deferred > 0;

ALTER TABLE revenue_recognition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_recognition_entries FORCE ROW LEVEL SECURITY;
