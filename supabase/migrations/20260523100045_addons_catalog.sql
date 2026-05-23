-- 0010_addons_catalog | Phase 1 | spec 3.13
CREATE TABLE addons_catalog (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text        UNIQUE NOT NULL CHECK (length(trim(code)) > 0),
  name              text        NOT NULL CHECK (length(trim(name)) > 0),
  category          text        NOT NULL CHECK (category IN ('capacity','feature','communication','ai','support')),
  description       text,
  price_inr_monthly numeric(10,2) CHECK (price_inr_monthly IS NULL OR price_inr_monthly >= 0),
  price_inr_yearly  numeric(10,2) CHECK (price_inr_yearly  IS NULL OR price_inr_yearly  >= 0),
  price_usd_monthly numeric(10,2) CHECK (price_usd_monthly IS NULL OR price_usd_monthly >= 0),
  price_usd_yearly  numeric(10,2) CHECK (price_usd_yearly  IS NULL OR price_usd_yearly  >= 0),
  applies_to_plans  text[],
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_addons_catalog_category ON addons_catalog (category) WHERE status = 'active';
ALTER TABLE addons_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE addons_catalog FORCE ROW LEVEL SECURITY;
