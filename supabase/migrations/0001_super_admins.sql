-- =====================================================================
-- 0001_super_admins  | Phase 1 | Foundational | no FK deps
-- Spec refs: 2.2, 2.9, 2.9.1, 2.9.5, 2.9.7, 2.9.8, 34.0 Phase 1.
-- Deferred to Phase 11: trg_auto_disable_sole_operator (needs platform_settings)
-- Deferred to Phase 12: RLS policies (Part 19.2). RLS itself is enabled now
--                       so the default-deny posture is in force from day one.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE super_admins (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext      NOT NULL,
  full_name       text        NOT NULL CHECK (length(trim(full_name)) > 0),
  role            text        NOT NULL
                              CHECK (role IN (
                                'owner','admin','engineering',
                                'support','sales','finance','auditor'
                              )),
  allowed_ips     inet[],
  recovery_email  citext,
  recovery_phone  text        CHECK (
                                recovery_phone IS NULL
                                OR recovery_phone ~ '^\+[1-9][0-9]{6,14}$'
                              ),
  last_active_at  timestamptz,
  removed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (removed_at IS NULL OR removed_at <= now())
);

CREATE UNIQUE INDEX uq_super_admins_email_active
  ON super_admins (email)
  WHERE removed_at IS NULL;

CREATE INDEX idx_super_admins_role_active
  ON super_admins (role)
  WHERE removed_at IS NULL;

CREATE INDEX idx_super_admins_inactive_eng_support
  ON super_admins (last_active_at)
  WHERE removed_at IS NULL
    AND role IN ('engineering','support');

CREATE INDEX idx_super_admins_recovery_email
  ON super_admins (recovery_email)
  WHERE recovery_email IS NOT NULL AND removed_at IS NULL;

CREATE OR REPLACE FUNCTION super_admins_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_super_admins_updated_at
  BEFORE UPDATE ON super_admins
  FOR EACH ROW EXECUTE FUNCTION super_admins_set_updated_at();

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admins FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE  super_admins                IS 'Platform staff (Layer 1). 7 roles per spec 2.9.1.';
COMMENT ON COLUMN super_admins.role           IS 'Spec 2.9.1: owner, admin, engineering, support, sales, finance, auditor.';
COMMENT ON COLUMN super_admins.allowed_ips    IS 'IP allowlist (spec 2.9.7). NULL = unrestricted.';
COMMENT ON COLUMN super_admins.last_active_at IS 'Drives 90-day auto-expiry for engineering and support (spec 2.9.5).';
COMMENT ON COLUMN super_admins.removed_at     IS 'Soft delete. Active row when removed_at IS NULL.';
