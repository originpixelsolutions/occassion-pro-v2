-- Phase 2 Unit 36: dunning_events (spec 3.14.6).
-- 5-touchpoint dunning sequence log. attempt 1..5 corresponds to
-- Days 1/3/5/9/14. UNIQUE (invoice_id, attempt_number, channel)
-- prevents the worker from double-firing a step.
-- invoice_id FK lands in Phase 6 (invoices).

CREATE TABLE dunning_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  invoice_id      uuid,
  attempt_number  integer     NOT NULL CHECK (attempt_number BETWEEN 1 AND 5),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  channel         text        NOT NULL CHECK (channel IN ('email','sms','in_app','phone_call_scheduled')),
  outcome         text        NOT NULL DEFAULT 'sent' CHECK (outcome IN ('sent','delivered','opened','clicked','paid','no_response','bounced','complained')),
  recipient_email citext      CHECK (recipient_email IS NULL OR (recipient_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(recipient_email) <= 254)),
  template_code   text        CHECK (template_code IS NULL OR length(trim(template_code)) BETWEEN 1 AND 80),
  provider_id     text        CHECK (provider_id IS NULL OR length(trim(provider_id)) BETWEEN 1 AND 200),
  notes           text        CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dunning_tenant      ON dunning_events (tenant_id, sent_at DESC);
CREATE INDEX idx_dunning_invoice     ON dunning_events (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_dunning_outcome     ON dunning_events (outcome, sent_at);
CREATE INDEX idx_dunning_unresolved  ON dunning_events (sent_at) WHERE outcome IN ('sent','delivered','opened','clicked');
CREATE INDEX idx_dunning_provider_id ON dunning_events (provider_id) WHERE provider_id IS NOT NULL;

CREATE UNIQUE INDEX uq_dunning_invoice_attempt_channel
  ON dunning_events (invoice_id, attempt_number, channel)
  WHERE invoice_id IS NOT NULL;

ALTER TABLE dunning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dunning_events FORCE ROW LEVEL SECURITY;
