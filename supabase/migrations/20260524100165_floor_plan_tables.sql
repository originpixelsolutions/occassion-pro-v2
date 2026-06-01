-- Phase 3 Unit 33: floor_plan_tables (spec line 2216).
-- Tables on a floor plan with shape, seat count, position,
-- rotation. table_shape enum widened from spec to include
-- square and oval (common variants in spec's banquet style
-- catalog). seat_count bounded 1-100, rotation 0-360, position
-- 0-100000 (works with floor_plans width/height cap).
--
-- Partial UNIQUE (floor_plan_id, lower(table_number)) WHERE
-- deleted_at IS NULL: case-insensitive uniqueness within the
-- plan so 'A1' and 'a1' don't conflict at the UI but ARE
-- treated as the same identifier in the DB.
--
-- Carries tenant_id and event_id denormalized so RLS policies
-- can filter without joining through floor_plans. Tenant-match
-- trigger asserts (tenant_id, event_id) on the table matches
-- (tenant_id, event_id) on the parent floor_plan.

CREATE TABLE floor_plan_tables (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  floor_plan_id   uuid          NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  event_id        uuid          NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  table_number    text          NOT NULL CHECK (length(trim(table_number)) BETWEEN 1 AND 30),
  table_shape     text          NOT NULL DEFAULT 'round' CHECK (table_shape IN ('round','rectangular','cocktail','banquet_row','square','oval')),
  seat_count      integer       NOT NULL CHECK (seat_count > 0 AND seat_count <= 100),
  position_x      numeric(10,2) NOT NULL CHECK (position_x >= 0 AND position_x <= 100000),
  position_y      numeric(10,2) NOT NULL CHECK (position_y >= 0 AND position_y <= 100000),
  rotation_deg    numeric(5,2)  NOT NULL DEFAULT 0 CHECK (rotation_deg >= 0 AND rotation_deg < 360),
  width           numeric(10,2) CHECK (width IS NULL OR width > 0),
  height          numeric(10,2) CHECK (height IS NULL OR height > 0),
  zone            text          CHECK (zone IS NULL OR length(trim(zone)) BETWEEN 1 AND 80),
  label           text          CHECK (label IS NULL OR length(label) <= 200),
  is_vip          boolean       NOT NULL DEFAULT FALSE,
  is_accessible   boolean       NOT NULL DEFAULT FALSE,
  deleted_at      timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_floor_plan_tables_number
  ON floor_plan_tables (floor_plan_id, lower(table_number)) WHERE deleted_at IS NULL;

CREATE INDEX idx_floor_plan_tables_plan    ON floor_plan_tables (floor_plan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_floor_plan_tables_event   ON floor_plan_tables (event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_floor_plan_tables_tenant  ON floor_plan_tables (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_floor_plan_tables_zone    ON floor_plan_tables (floor_plan_id, zone) WHERE zone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_floor_plan_tables_vip     ON floor_plan_tables (floor_plan_id) WHERE is_vip = TRUE AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION floor_plan_tables_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE plan_tenant uuid; plan_event uuid;
BEGIN
  SELECT tenant_id, event_id INTO plan_tenant, plan_event FROM floor_plans WHERE id = NEW.floor_plan_id;
  IF plan_tenant IS NULL THEN
    RAISE EXCEPTION 'floor_plan_tables.floor_plan_id % not found', NEW.floor_plan_id USING ERRCODE = '23503';
  END IF;
  IF plan_tenant <> NEW.tenant_id OR plan_event <> NEW.event_id THEN
    RAISE EXCEPTION 'floor_plan_tables.tenant_id/event_id (%, %) does not match floor_plan (%, %)',
      NEW.tenant_id, NEW.event_id, plan_tenant, plan_event USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_floor_plan_tables_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, floor_plan_id ON floor_plan_tables
  FOR EACH ROW EXECUTE FUNCTION floor_plan_tables_check_tenant_match();

ALTER TABLE floor_plan_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_plan_tables FORCE ROW LEVEL SECURITY;
