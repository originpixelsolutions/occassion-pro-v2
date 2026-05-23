-- 0008_feature_flags_and_plan_feature_flags | Phase 1 | spec 3.9
CREATE TABLE feature_flags (
  code            text        PRIMARY KEY CHECK (length(trim(code)) > 0),
  name            text        NOT NULL CHECK (length(trim(name)) > 0),
  description     text,
  default_enabled boolean     NOT NULL DEFAULT FALSE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;

CREATE TABLE plan_feature_flags (
  plan_id   uuid    NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  flag_code text    NOT NULL REFERENCES feature_flags(code)    ON DELETE CASCADE,
  enabled   boolean NOT NULL,
  PRIMARY KEY (plan_id, flag_code)
);
CREATE INDEX idx_plan_feature_flags_flag ON plan_feature_flags (flag_code);
ALTER TABLE plan_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_feature_flags FORCE ROW LEVEL SECURITY;
