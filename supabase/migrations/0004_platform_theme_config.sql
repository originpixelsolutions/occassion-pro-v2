-- =====================================================================
-- 0004_platform_theme_config | Phase 1 | Foundational
-- Spec refs: 33.10 (platform theme tokens), 33.10.3 (state machine),
--            34.0 Phase 1 seed (default v2 palette row).
-- Depends on: super_admins (FK draft_by, approved_by).
-- Singleton: exactly one row, id = 1. Updated through the
-- draft -> staged -> live -> rollback state machine.
-- =====================================================================

-- Reusable domain: 6-digit hex color. Used here and in 0005, plus the
-- tenant white-label override columns in a later Phase 2 migration.
CREATE DOMAIN hex_color AS text
  CHECK (VALUE ~ '^#[0-9A-Fa-f]{6}$');

CREATE TABLE platform_theme_config (
  id                          integer     PRIMARY KEY DEFAULT 1
                                          CHECK (id = 1),

  -- Brand (v2 palette: amber -> coral)
  brand_primary               hex_color   NOT NULL DEFAULT '#CA4B32',
  brand_primary_dark          hex_color   NOT NULL DEFAULT '#DD6850',
  brand_secondary             hex_color   NOT NULL DEFAULT '#E2A528',
  brand_gradient_start        hex_color   NOT NULL DEFAULT '#E2A528',
  brand_gradient_end          hex_color   NOT NULL DEFAULT '#CA4B32',
  brand_gradient_angle        integer     NOT NULL DEFAULT 135
                                          CHECK (brand_gradient_angle BETWEEN 0 AND 360),

  -- Semantic
  color_success               hex_color   NOT NULL DEFAULT '#10B981',
  color_warning               hex_color   NOT NULL DEFAULT '#EAB308',
  color_danger                hex_color   NOT NULL DEFAULT '#DC2626',
  color_info                  hex_color   NOT NULL DEFAULT '#3B82F6',

  -- Light surfaces
  light_page_bg               hex_color   NOT NULL DEFAULT '#EDF0F4',
  light_sidebar_bg            hex_color   NOT NULL DEFAULT '#F7F9FB',
  light_card_bg               hex_color   NOT NULL DEFAULT '#FFFFFF',
  light_hover_bg              hex_color   NOT NULL DEFAULT '#F1F4F8',
  light_border_default        hex_color   NOT NULL DEFAULT '#D5DAE0',
  light_text_primary          hex_color   NOT NULL DEFAULT '#0F1115',
  light_text_secondary        hex_color   NOT NULL DEFAULT '#4A5260',
  light_text_tertiary         hex_color   NOT NULL DEFAULT '#6C7380',

  -- Dark surfaces
  dark_page_bg                hex_color   NOT NULL DEFAULT '#04050A',
  dark_sidebar_bg             hex_color   NOT NULL DEFAULT '#0E1015',
  dark_card_bg                hex_color   NOT NULL DEFAULT '#1B1E25',
  dark_hover_bg               hex_color   NOT NULL DEFAULT '#252932',
  dark_border_default         hex_color   NOT NULL DEFAULT '#2D3138',
  dark_text_primary           hex_color   NOT NULL DEFAULT '#F4F5F8',
  dark_text_secondary         hex_color   NOT NULL DEFAULT '#A0A6B0',
  dark_text_tertiary          hex_color   NOT NULL DEFAULT '#6C7380',

  -- Typography
  font_family_sans            text        NOT NULL DEFAULT 'Inter, Noto Sans, system-ui, sans-serif',
  font_family_serif           text        NOT NULL DEFAULT 'Fraunces, Georgia, serif',
  font_family_mono            text        NOT NULL DEFAULT 'JetBrains Mono, ui-monospace, monospace',

  -- Radius scale (px)
  radius_sm                   integer     NOT NULL DEFAULT 6
                                          CHECK (radius_sm BETWEEN 0 AND 64),
  radius_md                   integer     NOT NULL DEFAULT 8
                                          CHECK (radius_md BETWEEN 0 AND 64),
  radius_lg                   integer     NOT NULL DEFAULT 12
                                          CHECK (radius_lg BETWEEN 0 AND 64),
  radius_xl                   integer     NOT NULL DEFAULT 16
                                          CHECK (radius_xl BETWEEN 0 AND 64),

  -- Default mode
  default_theme_mode          text        NOT NULL DEFAULT 'auto'
                                          CHECK (default_theme_mode IN ('light','dark','auto')),

  -- Lifecycle (spec 33.10.3 state machine)
  version                     integer     NOT NULL DEFAULT 1
                                          CHECK (version >= 1),
  status                      text        NOT NULL DEFAULT 'live'
                                          CHECK (status IN ('draft','staged','live','rollback')),
  draft_started_at            timestamptz,
  staged_at                   timestamptz,
  published_at                timestamptz,
  rolled_back_at              timestamptz,

  draft_by                    uuid        REFERENCES super_admins(id) ON DELETE SET NULL,
  approved_by                 uuid        REFERENCES super_admins(id) ON DELETE SET NULL,

  -- The lifecycle timestamps must be consistent with status. Loose
  -- constraint: each timestamp set => that state was visited.
  CHECK (status <> 'staged'   OR staged_at      IS NOT NULL),
  CHECK (status <> 'live'     OR published_at   IS NOT NULL OR version = 1),
  CHECK (status <> 'rollback' OR rolled_back_at IS NOT NULL),
  CHECK (approved_by IS NULL OR draft_by IS NOT NULL),
  CHECK (draft_by IS NULL OR approved_by IS NULL OR draft_by <> approved_by),

  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ptc_draft_by   ON platform_theme_config (draft_by)
  WHERE draft_by IS NOT NULL;
CREATE INDEX idx_ptc_approved_by ON platform_theme_config (approved_by)
  WHERE approved_by IS NOT NULL;

CREATE OR REPLACE FUNCTION platform_theme_config_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_platform_theme_config_updated_at
  BEFORE UPDATE ON platform_theme_config
  FOR EACH ROW EXECUTE FUNCTION platform_theme_config_set_updated_at();

ALTER TABLE platform_theme_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_theme_config FORCE ROW LEVEL SECURITY;

-- Phase 12 seed line says "default platform_theme_config row with
-- confirmed v2 palette". We seed it here so theme reads work from day
-- one; the row's defaults ARE the v2 palette.
INSERT INTO platform_theme_config (id) VALUES (1);

COMMENT ON TABLE  platform_theme_config         IS 'Singleton platform theme tokens (spec 33.10). One row, id = 1. Edited via draft->staged->live->rollback state machine (spec 33.10.3).';
COMMENT ON DOMAIN hex_color                     IS '6-digit hex color, e.g. #CA4B32. Used by platform_theme_config and tenant white-label override columns.';
COMMENT ON COLUMN platform_theme_config.status  IS 'Lifecycle state: draft | staged | live | rollback (spec 33.10.3).';
COMMENT ON COLUMN platform_theme_config.version IS 'Monotonic version. Incremented on each promote-to-live.';
