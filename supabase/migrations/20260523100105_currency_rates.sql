-- 0014_currency_rates | Phase 1 | spec 4.3
CREATE TABLE currency_rates (
  rate_date   date          NOT NULL,
  base_code   varchar(3)    NOT NULL CHECK (base_code ~ '^[A-Z]{3}$'),
  target_code varchar(3)    NOT NULL CHECK (target_code ~ '^[A-Z]{3}$'),
  rate        numeric(18,8) NOT NULL CHECK (rate > 0),
  source      text          NOT NULL CHECK (length(trim(source)) > 0),
  PRIMARY KEY (rate_date, base_code, target_code),
  CHECK (base_code <> target_code)
);
CREATE INDEX idx_currency_rates_date ON currency_rates (rate_date DESC);
ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_rates FORCE ROW LEVEL SECURITY;
