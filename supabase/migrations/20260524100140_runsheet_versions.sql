-- Phase 3 Unit 28: runsheet_versions (spec lines 2298-2310).
-- Time-travel + audit snapshots of the runsheet. Two variants
-- coexist in the same table via the spec's full_or_diff CHECK:
--   FULL (is_full=TRUE):  snapshot jsonb present, no diff, no base
--   DIFF (is_full=FALSE): diff jsonb present + base_version_id NOT NULL
--
-- A chain of diffs must terminate at a full snapshot. The
-- cycle-prevention trigger on base_version_id uses a recursive
-- CTE so an attacker can't build A -> B -> A delta loops.
--
-- Size caps: snapshot < 16 MiB (whole runsheet jsonb), diff
-- < 4 MiB (per-event-update delta). Both must be jsonb objects
-- (jsonb_typeof = 'object') to prevent arrays / scalars.
--
-- version_label is an optional human label ('pre-publish',
-- 'post-vendor-change', etc). task_count is denormalized for
-- fast "how many tasks at this version" queries without
-- re-parsing the jsonb.
--
-- Four-way tenant-match trigger: event + base_version (must
-- match BOTH tenant AND event - delta chains can't cross
-- events) + creator member all belong to the version's tenant.

CREATE TABLE runsheet_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  is_full         boolean     NOT NULL DEFAULT FALSE,
  snapshot        jsonb       CHECK (snapshot IS NULL OR (jsonb_typeof(snapshot) = 'object' AND pg_column_size(snapshot) < 16777216)),
  diff            jsonb       CHECK (diff IS NULL OR (jsonb_typeof(diff) = 'object' AND pg_column_size(diff) < 4194304)),
  base_version_id uuid        REFERENCES runsheet_versions(id) ON DELETE SET NULL,
  version_label   text        CHECK (version_label IS NULL OR length(trim(version_label)) BETWEEN 1 AND 100),
  task_count      integer     CHECK (task_count IS NULL OR task_count >= 0),
  created_by      uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  purge_after     timestamptz,
  CONSTRAINT no_self_base CHECK (id <> base_version_id),
  CONSTRAINT full_or_diff CHECK (
    (is_full = TRUE  AND snapshot IS NOT NULL AND diff IS NULL AND base_version_id IS NULL)
    OR (is_full = FALSE AND diff IS NOT NULL AND base_version_id IS NOT NULL AND snapshot IS NULL)
  ),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_runsheet_versions_event_time ON runsheet_versions (event_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_runsheet_versions_tenant     ON runsheet_versions (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_runsheet_versions_base       ON runsheet_versions (base_version_id) WHERE base_version_id IS NOT NULL;
CREATE INDEX idx_runsheet_versions_creator    ON runsheet_versions (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_runsheet_versions_full       ON runsheet_versions (event_id, created_at DESC) WHERE is_full = TRUE AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION prevent_runsheet_version_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_version_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE chain AS (
      SELECT id, base_version_id FROM runsheet_versions WHERE id = NEW.base_version_id
      UNION ALL
      SELECT v.id, v.base_version_id FROM runsheet_versions v JOIN chain c ON v.id = c.base_version_id
    ) SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'runsheet_versions base_version_id cycle detected via version %', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_runsheet_versions_cycle_check
  BEFORE INSERT OR UPDATE OF base_version_id ON runsheet_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_runsheet_version_cycle();

CREATE OR REPLACE FUNCTION runsheet_versions_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; base_tenant uuid; base_event uuid; creator_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'runsheet_versions.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'runsheet_versions.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  IF NEW.base_version_id IS NOT NULL THEN
    SELECT tenant_id, event_id INTO base_tenant, base_event FROM runsheet_versions WHERE id = NEW.base_version_id;
    IF base_tenant IS NULL THEN
      RAISE EXCEPTION 'runsheet_versions.base_version_id % not found', NEW.base_version_id USING ERRCODE = '23503';
    END IF;
    IF base_tenant <> NEW.tenant_id OR base_event <> NEW.event_id THEN
      RAISE EXCEPTION 'runsheet_versions.base_version_id % does not match tenant/event', NEW.base_version_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'runsheet_versions.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_runsheet_versions_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, base_version_id, created_by ON runsheet_versions
  FOR EACH ROW EXECUTE FUNCTION runsheet_versions_check_tenant_match();

ALTER TABLE runsheet_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE runsheet_versions FORCE ROW LEVEL SECURITY;
