-- Phase 7 Unit 50: storage_cleanup_suggestions (spec 4.8 line 1484).
-- Smart-cleanup suggestions surfaced by SmartCleanupSuggester
-- when storage quota crosses 80%. Each row is one actionable
-- recommendation that the tenant can dismiss or apply.
--
-- suggestion_type enum expanded from spec's 5 to 9: the
-- original five plus archive_old_events, compress_videos,
-- dedupe_uploads, retention_purge.
--
-- Status state machine: open -> applied | dismissed | superseded
-- | expired. Per-state prereq CHECKs:
--   dismissed  : dismissed_at AND dismissed_reason NOT NULL
--   applied    : applied_at NOT NULL
--   superseded : superseded_by NOT NULL (and != id via
--                no_self_supersede)
--
-- Cycle prevention on superseded_by via recursive CTE so
-- a chain of replacing suggestions can't close into a loop.
--
-- target_event_ids capped at 500 (an array longer than that
-- should be a per-event-batch sweep, not a suggestion). bytes_
-- to_free and target_object_count >= 0. estimated_savings_usd
-- uses numeric(10,4) for fractional-cent precision.
--
-- Three-way tenant-match trigger: dismissed_by + applied_by
-- members both belong to the row's tenant. Prevents tenant-B
-- members from being recorded as dismissers/appliers on
-- tenant-A suggestions.

CREATE TABLE storage_cleanup_suggestions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  suggestion_type   text        NOT NULL CHECK (suggestion_type IN (
                      'lite_archive_old','delete_duplicates','delete_old_exports',
                      'delete_old_pdfs','offload_old','archive_old_events',
                      'compress_videos','dedupe_uploads','retention_purge')),
  priority          text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  target_event_ids  uuid[]      CHECK (target_event_ids IS NULL OR (array_length(target_event_ids, 1) IS NULL OR array_length(target_event_ids, 1) <= 500)),
  target_object_count integer   CHECK (target_object_count IS NULL OR target_object_count >= 0),
  bytes_to_free     bigint      CHECK (bytes_to_free IS NULL OR bytes_to_free >= 0),
  estimated_savings_usd numeric(10,4) CHECK (estimated_savings_usd IS NULL OR estimated_savings_usd >= 0),
  description       text        NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
  rationale         text        CHECK (rationale IS NULL OR length(rationale) <= 4000),
  status            text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','applied','superseded','expired')),
  generated_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  dismissed_at      timestamptz,
  dismissed_by      uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  dismissed_reason  text        CHECK (dismissed_reason IS NULL OR length(dismissed_reason) <= 1000),
  applied_at        timestamptz,
  applied_by        uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  applied_bytes_freed bigint    CHECK (applied_bytes_freed IS NULL OR applied_bytes_freed >= 0),
  superseded_by     uuid        REFERENCES storage_cleanup_suggestions(id) ON DELETE SET NULL,
  metadata          jsonb       CHECK (metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) < 32768)),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_supersede CHECK (id <> superseded_by),
  CHECK (status <> 'dismissed'  OR (dismissed_at IS NOT NULL AND dismissed_reason IS NOT NULL)),
  CHECK (status <> 'applied'    OR applied_at IS NOT NULL),
  CHECK (status <> 'superseded' OR superseded_by IS NOT NULL),
  CHECK (expires_at IS NULL OR expires_at > generated_at),
  CHECK (dismissed_at IS NULL OR dismissed_at >= generated_at),
  CHECK (applied_at IS NULL OR applied_at >= generated_at)
);

CREATE INDEX idx_cleanup_tenant_open   ON storage_cleanup_suggestions (tenant_id, generated_at DESC) WHERE status = 'open';
CREATE INDEX idx_cleanup_tenant_status ON storage_cleanup_suggestions (tenant_id, status, generated_at DESC);
CREATE INDEX idx_cleanup_type          ON storage_cleanup_suggestions (tenant_id, suggestion_type) WHERE status = 'open';
CREATE INDEX idx_cleanup_priority      ON storage_cleanup_suggestions (tenant_id, priority, generated_at DESC) WHERE status = 'open';
CREATE INDEX idx_cleanup_expiring      ON storage_cleanup_suggestions (expires_at) WHERE expires_at IS NOT NULL AND status = 'open';
CREATE INDEX idx_cleanup_dismisser     ON storage_cleanup_suggestions (dismissed_by) WHERE dismissed_by IS NOT NULL;
CREATE INDEX idx_cleanup_applier       ON storage_cleanup_suggestions (applied_by) WHERE applied_by IS NOT NULL;
CREATE INDEX idx_cleanup_superseded    ON storage_cleanup_suggestions (superseded_by) WHERE superseded_by IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_storage_cleanup_supersede_cycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_by IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE chain AS (
      SELECT id, superseded_by FROM storage_cleanup_suggestions WHERE id = NEW.superseded_by
      UNION ALL
      SELECT s.id, s.superseded_by FROM storage_cleanup_suggestions s JOIN chain c ON s.id = c.superseded_by
    ) SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'storage_cleanup_suggestions superseded_by cycle via suggestion %', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_storage_cleanup_supersede_cycle
  BEFORE INSERT OR UPDATE OF superseded_by ON storage_cleanup_suggestions
  FOR EACH ROW EXECUTE FUNCTION prevent_storage_cleanup_supersede_cycle();

CREATE OR REPLACE FUNCTION storage_cleanup_suggestions_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE dismisser_tenant uuid; applier_tenant uuid;
BEGIN
  IF NEW.dismissed_by IS NOT NULL THEN
    SELECT tenant_id INTO dismisser_tenant FROM tenant_members WHERE id = NEW.dismissed_by;
    IF dismisser_tenant IS NULL OR dismisser_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'storage_cleanup_suggestions.dismissed_by % does not belong to tenant %', NEW.dismissed_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.applied_by IS NOT NULL THEN
    SELECT tenant_id INTO applier_tenant FROM tenant_members WHERE id = NEW.applied_by;
    IF applier_tenant IS NULL OR applier_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'storage_cleanup_suggestions.applied_by % does not belong to tenant %', NEW.applied_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_storage_cleanup_suggestions_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, dismissed_by, applied_by ON storage_cleanup_suggestions
  FOR EACH ROW EXECUTE FUNCTION storage_cleanup_suggestions_check_tenant_match();

ALTER TABLE storage_cleanup_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_cleanup_suggestions FORCE ROW LEVEL SECURITY;
