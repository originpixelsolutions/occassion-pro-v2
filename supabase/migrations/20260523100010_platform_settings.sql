-- =====================================================================
-- 0003_platform_settings | Phase 1 | Foundational
-- Spec refs: 2.9.2 (Sole Operator Mode), 2.9.8 (auto_disable trigger
--            lands Phase 11), 34.0 Phase 1.
-- Singleton table: exactly one row, id always 1. The Phase 11 trigger
-- UPDATEs this row when a second owner/admin is added.
-- =====================================================================

CREATE TABLE platform_settings (
  id                          smallint    PRIMARY KEY DEFAULT 1
                                          CHECK (id = 1),

  -- Spec 2.9.2: starts TRUE on a fresh install (one owner exists).
  -- Flipped to FALSE by the Phase 11 trigger when a second owner/admin
  -- is added. Cannot be re-enabled.
  sole_operator_mode          boolean     NOT NULL DEFAULT TRUE,
  sole_operator_disabled_at   timestamptz,

  -- Invariant: once disabled, the disabled_at timestamp must exist;
  -- and a disabled row must not advertise sole_operator_mode = TRUE.
  CHECK (
    (sole_operator_mode = TRUE  AND sole_operator_disabled_at IS NULL)
    OR
    (sole_operator_mode = FALSE AND sole_operator_disabled_at IS NOT NULL)
  ),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION platform_settings_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION platform_settings_set_updated_at();

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings FORCE ROW LEVEL SECURITY;

-- Seed the one and only row so the Phase 11 trigger can UPDATE it.
INSERT INTO platform_settings (id) VALUES (1);

COMMENT ON TABLE  platform_settings                          IS 'Singleton platform config. Exactly one row, id = 1. Holds Sole Operator Mode (spec 2.9.2) and future global settings.';
COMMENT ON COLUMN platform_settings.sole_operator_mode       IS 'Spec 2.9.2: TRUE on fresh install. Flipped FALSE (one-way) by Phase 11 trigger when a second owner/admin is added.';
COMMENT ON COLUMN platform_settings.sole_operator_disabled_at IS 'Set by Phase 11 trigger at the moment Sole Operator Mode auto-disables.';
