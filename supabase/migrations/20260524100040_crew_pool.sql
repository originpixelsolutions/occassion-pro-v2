-- Phase 3 Unit 9: crew_pool (spec 8.5).
-- Per-tenant freelance/contracted crew roster. citext email (case-fold);
-- E.164 phone; rate/currency coupling. Partial UNIQUE on phone and
-- email per active row.

CREATE TABLE crew_pool (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  full_name           text          NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 200),
  phone               text          CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  email               citext        CHECK (email IS NULL OR (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254)),
  role                text          CHECK (role IS NULL OR role IN ('supervisor','runner','greeter','technical','security','usher','crowd_control','sound','lighting','stage_hand','translator','medic','driver','other')),
  hourly_rate         numeric(10,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  daily_rate          numeric(10,2) CHECK (daily_rate  IS NULL OR daily_rate  >= 0),
  currency_code       varchar(3)    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  skills              text[]        CHECK (skills    IS NULL OR cardinality(skills)    <= 30),
  languages           text[]        CHECK (languages IS NULL OR cardinality(languages) <= 20),
  is_freelance        boolean       NOT NULL DEFAULT TRUE,
  is_active           boolean       NOT NULL DEFAULT TRUE,
  notes               text          CHECK (notes IS NULL OR length(notes) <= 4000),
  rating              numeric(2,1)  CHECK (rating IS NULL OR (rating >= 1.0 AND rating <= 5.0)),
  total_events_worked integer       NOT NULL DEFAULT 0 CHECK (total_events_worked >= 0),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  CHECK ((hourly_rate IS NULL AND daily_rate IS NULL) OR currency_code IS NOT NULL)
);

CREATE UNIQUE INDEX uq_crew_pool_phone_active
  ON crew_pool (tenant_id, phone) WHERE phone IS NOT NULL AND is_active;
CREATE UNIQUE INDEX uq_crew_pool_email_active
  ON crew_pool (tenant_id, email) WHERE email IS NOT NULL AND is_active;

CREATE INDEX idx_crew_pool_tenant    ON crew_pool (tenant_id) WHERE is_active;
CREATE INDEX idx_crew_pool_role      ON crew_pool (tenant_id, role) WHERE is_active AND role IS NOT NULL;
CREATE INDEX idx_crew_pool_freelance ON crew_pool (tenant_id) WHERE is_active AND is_freelance;

ALTER TABLE crew_pool ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_pool FORCE ROW LEVEL SECURITY;
