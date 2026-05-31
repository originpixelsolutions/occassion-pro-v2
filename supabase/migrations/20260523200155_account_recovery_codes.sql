-- Phase 2 Unit 32: account_recovery_codes (spec 19.1.5).
-- Single-use MFA recovery codes. code_hash = sha256(plaintext); plaintext
-- is shown once at MFA setup. consumed_at/consumed_ip travel as a pair.
-- Trigger caps unconsumed codes at 20 per (user, user_type).

CREATE TABLE account_recovery_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  user_type   text        NOT NULL CHECK (user_type IN ('tenant_member','super_admin','client','vendor','speaker')),
  code_hash   text        NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  consumed_at timestamptz,
  consumed_ip inet,
  consumed_ua text        CHECK (consumed_ua IS NULL OR length(consumed_ua) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((consumed_at IS NULL) = (consumed_ip IS NULL)),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX idx_recovery_codes_active ON account_recovery_codes (user_id, user_type) WHERE consumed_at IS NULL;
CREATE INDEX idx_recovery_codes_owner  ON account_recovery_codes (user_id, user_type);
CREATE INDEX idx_recovery_codes_recent ON account_recovery_codes (consumed_at) WHERE consumed_at IS NOT NULL;

ALTER TABLE account_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_recovery_codes FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION trg_arc_cap_active_per_user() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM account_recovery_codes
   WHERE user_id   = NEW.user_id
     AND user_type = NEW.user_type
     AND consumed_at IS NULL;
  IF n >= 20 THEN
    RAISE EXCEPTION 'arc_too_many_active: % already has 20 unconsumed codes', NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_arc_cap_active_per_user
BEFORE INSERT ON account_recovery_codes
FOR EACH ROW EXECUTE FUNCTION trg_arc_cap_active_per_user();
