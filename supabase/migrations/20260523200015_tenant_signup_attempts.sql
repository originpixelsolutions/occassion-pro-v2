-- Phase 2 Unit 4: tenant_signup_attempts (spec 3.4.1, 3.4.2).
-- Anti-abuse log: tracks every signup attempt with email hash, IP,
-- device fingerprint, and outcome enum. Used by behavioral analyzer.

CREATE TABLE tenant_signup_attempts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash         text        NOT NULL CHECK (length(email_hash) = 64),
  email              text        NOT NULL CHECK (length(trim(email)) > 0),
  ip_address         inet        NOT NULL,
  ip_country         varchar(2)  CHECK (ip_country IS NULL OR ip_country ~ '^[A-Z]{2}$'),
  user_agent         text,
  device_fingerprint text,
  outcome            text        NOT NULL CHECK (outcome IN (
                                   'verified','rejected_captcha','rejected_disposable',
                                   'rejected_ip_rate_limit','rejected_device_fingerprint',
                                   'rejected_behavioral_pattern','approved','rejected_manual','expired'
                                 )),
  risk_score         numeric(3,2) CHECK (risk_score IS NULL OR (risk_score BETWEEN 0 AND 1)),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_signup_attempts_email_hash  ON tenant_signup_attempts (email_hash);
CREATE INDEX idx_signup_attempts_ip          ON tenant_signup_attempts (ip_address, created_at);
CREATE INDEX idx_signup_attempts_fingerprint ON tenant_signup_attempts (device_fingerprint, created_at) WHERE device_fingerprint IS NOT NULL;
CREATE INDEX idx_signup_attempts_outcome     ON tenant_signup_attempts (outcome, created_at);

ALTER TABLE tenant_signup_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_signup_attempts FORCE ROW LEVEL SECURITY;
