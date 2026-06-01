-- Phase 3 Unit 34: floor_plan_table_guests (spec line 2229).
-- Junction linking floor_plan_tables to guests for the seating
-- chart. Composite PK (table_id, guest_id) per spec, which
-- already enforces 'a guest can't be seated at the same table
-- twice'.
--
-- Per-seat uniqueness: partial UNIQUE on (table_id, seat_number)
-- WHERE seat_number IS NOT NULL - two guests can't share the
-- same numbered seat, but unassigned seats (seat_number NULL)
-- are allowed in unlimited number per table.
--
-- Per-plan uniqueness for a guest: enforced via a BEFORE
-- trigger (not a UNIQUE index, because the constraint requires
-- joining through floor_plan_tables). A guest can sit on at
-- most one table within a given plan, but the same guest can
-- have alternative seating assignments across different plans
-- of the same event (the planning UI lets the organiser try
-- different layouts).
--
-- Five-way tenant-match trigger: table + guest + assigned_by
-- member all belong to the row's tenant, AND
-- floor_plan_tables.event_id = guests.event_id = row.event_id
-- (no cross-event seating).

CREATE TABLE floor_plan_table_guests (
  table_id      uuid        NOT NULL REFERENCES floor_plan_tables(id) ON DELETE CASCADE,
  guest_id      uuid        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id      uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seat_number   integer     CHECK (seat_number IS NULL OR (seat_number > 0 AND seat_number <= 100)),
  assigned_by   uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  is_plus_one   boolean     NOT NULL DEFAULT FALSE,
  notes         text        CHECK (notes IS NULL OR length(notes) <= 1000),
  PRIMARY KEY (table_id, guest_id)
);

CREATE UNIQUE INDEX uq_floor_plan_table_guests_seat
  ON floor_plan_table_guests (table_id, seat_number) WHERE seat_number IS NOT NULL;

CREATE INDEX idx_fp_table_guests_guest    ON floor_plan_table_guests (guest_id);
CREATE INDEX idx_fp_table_guests_table    ON floor_plan_table_guests (table_id);
CREATE INDEX idx_fp_table_guests_tenant   ON floor_plan_table_guests (tenant_id);
CREATE INDEX idx_fp_table_guests_assigner ON floor_plan_table_guests (assigned_by) WHERE assigned_by IS NOT NULL;

CREATE OR REPLACE FUNCTION floor_plan_table_guests_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE table_tenant uuid; table_event uuid; guest_tenant uuid; guest_event uuid; assigner_tenant uuid;
BEGIN
  SELECT tenant_id, event_id INTO table_tenant, table_event FROM floor_plan_tables WHERE id = NEW.table_id;
  SELECT tenant_id, event_id INTO guest_tenant, guest_event FROM guests WHERE id = NEW.guest_id;
  IF table_tenant IS NULL OR guest_tenant IS NULL THEN
    RAISE EXCEPTION 'floor_plan_table_guests parent rows not found' USING ERRCODE = '23503';
  END IF;
  IF table_tenant <> NEW.tenant_id OR guest_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'floor_plan_table_guests.tenant_id % does not match table/guest tenants', NEW.tenant_id USING ERRCODE = '23514';
  END IF;
  IF table_event <> NEW.event_id OR guest_event <> NEW.event_id THEN
    RAISE EXCEPTION 'floor_plan_table_guests.event_id % does not match table/guest events', NEW.event_id USING ERRCODE = '23514';
  END IF;
  IF NEW.assigned_by IS NOT NULL THEN
    SELECT tenant_id INTO assigner_tenant FROM tenant_members WHERE id = NEW.assigned_by;
    IF assigner_tenant IS NULL OR assigner_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'floor_plan_table_guests.assigned_by % does not belong to tenant %', NEW.assigned_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_floor_plan_table_guests_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, table_id, guest_id, assigned_by ON floor_plan_table_guests
  FOR EACH ROW EXECUTE FUNCTION floor_plan_table_guests_check_tenant_match();

-- Per-plan guest uniqueness (one assignment per (floor_plan, guest), enforced
-- via trigger because UNIQUE can't index across the join through floor_plan_tables).
CREATE OR REPLACE FUNCTION floor_plan_table_guests_check_unique_per_plan()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE new_plan uuid;
BEGIN
  SELECT floor_plan_id INTO new_plan FROM floor_plan_tables WHERE id = NEW.table_id;
  IF EXISTS (
    SELECT 1
    FROM floor_plan_table_guests g
    JOIN floor_plan_tables ft ON ft.id = g.table_id
    WHERE g.guest_id = NEW.guest_id
      AND ft.floor_plan_id = new_plan
      AND (TG_OP = 'INSERT' OR g.table_id <> NEW.table_id)
  ) THEN
    RAISE EXCEPTION 'guest % is already seated on plan % at another table', NEW.guest_id, new_plan USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_floor_plan_table_guests_unique_per_plan
  BEFORE INSERT OR UPDATE OF table_id, guest_id ON floor_plan_table_guests
  FOR EACH ROW EXECUTE FUNCTION floor_plan_table_guests_check_unique_per_plan();

ALTER TABLE floor_plan_table_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_plan_table_guests FORCE ROW LEVEL SECURITY;
