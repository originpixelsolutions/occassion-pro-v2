-- =====================================================================
-- 20260523100020_platform_theme_history | Phase 1 | Foundational
-- Spec refs: 33.10 (theme tokens), 33.10.3 (state machine), 14 (audit
--            log immutability principle), 34.0 Phase 1.
-- Depends on: super_admins (FK changed_by).
-- Append-only: every theme promotion writes a row. Updates and deletes
-- are blocked by triggers so the audit trail cannot be rewritten.
-- =====================================================================

CREATE TABLE platform_theme_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which theme version this snapshot represents.
  version       integer     NOT NULL CHECK (version >= 1),

  -- Frozen copy of platform_theme_config at the moment of publish.
  -- Stored as jsonb so a single row captures every token regardless
  -- of how the column set evolves over time. CHECK ensures the
  -- snapshot is a JSON object (not array / scalar / null).
  snapshot      jsonb       NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),

  -- Audit identity. ON DELETE RESTRICT because the table is append-only:
  -- the append-only trigger blocks the cascading UPDATE that SET NULL
  -- would issue. Hard-deleting a super_admin who appears in theme
  -- history is forbidden — use the removed_at soft-delete instead.
  changed_by    uuid        REFERENCES super_admins(id) ON DELETE RESTRICT,

  -- Optional human reason. If supplied, must be non-empty.
  reason        text        CHECK (reason IS NULL OR length(trim(reason)) > 0),

  -- When the snapshot was published. NOT NULL so every row is dated.
  published_at  timestamptz NOT NULL DEFAULT now()
);

-- "Newest first" lookups — the doc names this exact index.
CREATE INDEX idx_theme_history_version
  ON platform_theme_history (version DESC);

-- Time-range queries (rollback windows, weekly audit).
CREATE INDEX idx_theme_history_published_at
  ON platform_theme_history (published_at DESC);

-- FK index (project rule 2: FK indexes on every join column).
CREATE INDEX idx_theme_history_changed_by
  ON platform_theme_history (changed_by)
  WHERE changed_by IS NOT NULL;

-- ---------------------------------------------------------------------
-- Append-only enforcement. History rows must never be altered or
-- deleted; the audit trail is the source of truth for theme reverts.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform_theme_history_block_mutations()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION
    'platform_theme_history is append-only; % is not permitted',
    TG_OP
  USING ERRCODE = 'insufficient_privilege';
END;
$fn$;

CREATE TRIGGER trg_pth_no_update
  BEFORE UPDATE ON platform_theme_history
  FOR EACH ROW EXECUTE FUNCTION platform_theme_history_block_mutations();

CREATE TRIGGER trg_pth_no_delete
  BEFORE DELETE ON platform_theme_history
  FOR EACH ROW EXECUTE FUNCTION platform_theme_history_block_mutations();

ALTER TABLE platform_theme_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_theme_history FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE  platform_theme_history             IS 'Append-only audit log of platform_theme_config publishes (spec 33.10 / Part 14 immutability). Triggers block UPDATE and DELETE.';
COMMENT ON COLUMN platform_theme_history.snapshot    IS 'JSONB object copy of platform_theme_config row at publish time.';
COMMENT ON COLUMN platform_theme_history.published_at IS 'When this snapshot was promoted to live. Drives the rollback window.';
