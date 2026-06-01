-- Phase 3 Unit 32: floor_plans (spec line 2198).
-- Per-event floor-plan canvas backing the Konva.js editor (3
-- layers, grid snap, auto-suggest seating). canvas jsonb holds
-- the full scenegraph; capped <5 MiB via pg_column_size and
-- shape-checked with jsonb_typeof='object'.
--
-- Publish lifecycle enforced at the DB:
-- - is_published=TRUE requires BOTH published_at AND
--   published_by NOT NULL (no anonymous publishes).
-- - unpublished_at must come AFTER published_at when set.
--
-- Partial UNIQUE (event_id, lower(name)) WHERE deleted_at IS
-- NULL: an event can have many plans but not two with the
-- same name (case-insensitive). Soft-deleted plans free up
-- their name.
--
-- Three-way tenant-match trigger: event + created_by member +
-- published_by member all live in the plan's tenant.

CREATE TABLE floor_plans (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  canvas          jsonb       NOT NULL CHECK (jsonb_typeof(canvas) = 'object' AND pg_column_size(canvas) < 5242880),
  thumbnail_url   text        CHECK (thumbnail_url IS NULL OR (thumbnail_url ~ '^https://' AND length(thumbnail_url) BETWEEN 1 AND 2048)),
  width           integer     CHECK (width IS NULL OR (width > 0 AND width <= 100000)),
  height          integer     CHECK (height IS NULL OR (height > 0 AND height <= 100000)),
  is_published    boolean     NOT NULL DEFAULT FALSE,
  published_at    timestamptz,
  published_by    uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  unpublished_at  timestamptz,
  version         integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by      uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  deleted_at      timestamptz,
  purge_after     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (is_published = FALSE OR (published_at IS NOT NULL AND published_by IS NOT NULL)),
  CHECK (unpublished_at IS NULL OR (published_at IS NOT NULL AND unpublished_at >= published_at)),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_floor_plans_event       ON floor_plans (event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_floor_plans_tenant      ON floor_plans (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_floor_plans_published   ON floor_plans (event_id, published_at DESC) WHERE is_published = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_floor_plans_purge_due   ON floor_plans (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE UNIQUE INDEX uq_floor_plans_event_name_active
  ON floor_plans (event_id, lower(name)) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION floor_plans_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; creator_tenant uuid; publisher_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'floor_plans.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'floor_plans.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'floor_plans.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.published_by IS NOT NULL THEN
    SELECT tenant_id INTO publisher_tenant FROM tenant_members WHERE id = NEW.published_by;
    IF publisher_tenant IS NULL OR publisher_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'floor_plans.published_by % does not belong to tenant %', NEW.published_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_floor_plans_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, created_by, published_by ON floor_plans
  FOR EACH ROW EXECUTE FUNCTION floor_plans_check_tenant_match();

ALTER TABLE floor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_plans FORCE ROW LEVEL SECURITY;
