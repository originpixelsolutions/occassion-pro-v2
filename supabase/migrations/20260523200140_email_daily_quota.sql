-- Phase 2 Unit 29: email_daily_quota (spec 5.1).
-- Per-tenant per-day email send counter. Composite PK (tenant_id, date).
-- sent_count <= limit_value enforced at the DB.

CREATE TABLE email_daily_quota (
  tenant_id   uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  date        date        NOT NULL,
  sent_count  integer     NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  limit_value integer     NOT NULL CHECK (limit_value >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, date),
  CHECK (sent_count <= limit_value)
);

CREATE INDEX idx_edq_tenant_recent ON email_daily_quota (tenant_id, date DESC);
CREATE INDEX idx_edq_at_cap        ON email_daily_quota (tenant_id, date) WHERE sent_count >= limit_value;

ALTER TABLE email_daily_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_daily_quota FORCE ROW LEVEL SECURITY;
