-- 0017_sub_processor_incidents | Phase 1 | spec 19.12
CREATE TABLE sub_processor_incidents (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_processor                   text        NOT NULL CHECK (length(trim(sub_processor)) > 0),
  incident_date                   date        NOT NULL,
  disclosed_at                    timestamptz NOT NULL,
  affected_data                   text[]      NOT NULL DEFAULT '{}',
  affected_period_start           timestamptz,
  affected_period_end             timestamptz,
  estimated_tenants_affected      integer     CHECK (estimated_tenants_affected IS NULL OR estimated_tenants_affected >= 0),
  remediation_actions             jsonb,
  customer_notification_sent_at   timestamptz,
  regulator_notification_sent_at  timestamptz,
  status                          text        NOT NULL DEFAULT 'investigating'
                                              CHECK (status IN ('investigating','contained','resolved')),
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CHECK (affected_period_start IS NULL OR affected_period_end IS NULL OR affected_period_start <= affected_period_end),
  CHECK (disclosed_at >= incident_date::timestamptz)
);
CREATE INDEX idx_sub_processor_incidents_status ON sub_processor_incidents (status);
CREATE INDEX idx_sub_processor_incidents_date   ON sub_processor_incidents (incident_date DESC);
ALTER TABLE sub_processor_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_processor_incidents FORCE ROW LEVEL SECURITY;
