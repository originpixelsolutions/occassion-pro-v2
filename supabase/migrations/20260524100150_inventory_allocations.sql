-- Phase 3 Unit 30: inventory_allocations (spec line 2350).
-- Per-event inventory allocations. State machine:
--   allocated -> dispatched -> returned
--   (also damaged, lost, cancelled as terminal-ish states)
--
-- Quantity invariant at the row level:
--   damaged + lost + returned <= quantity
-- The remainder is still 'in use' or 'in flight'.
--
-- Per-state prereqs:
--   dispatched : dispatched_at NOT NULL
--   returned   : both dispatched_at AND returned_at NOT NULL
--                (and returned_at >= dispatched_at)
--   damaged    : quantity_damaged > 0 AND damage_notes NOT NULL
--   lost       : quantity_lost > 0
--   cancelled  : cancelled_at AND cancelled_reason NOT NULL
--
-- damage_cost + damage_currency two-way coupled. damage_cost
-- only allowed when quantity_damaged > 0.
--
-- Six-way tenant-match trigger: item, event, allocated_by,
-- dispatched_by, received_by, and the row's own tenant_id all
-- agree. Cross-tenant attacks blocked even with valid IDs.

CREATE TABLE inventory_allocations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inventory_item_id uuid        NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  event_id          uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  quantity          integer     NOT NULL CHECK (quantity > 0),
  quantity_damaged  integer     NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  quantity_lost     integer     NOT NULL DEFAULT 0 CHECK (quantity_lost >= 0),
  quantity_returned integer     NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  status            text        NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated','dispatched','returned','damaged','lost','cancelled')),
  allocated_at      timestamptz NOT NULL DEFAULT now(),
  dispatched_at     timestamptz,
  returned_at       timestamptz,
  cancelled_at      timestamptz,
  cancelled_reason  text        CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 1000),
  damage_notes      text        CHECK (damage_notes IS NULL OR length(damage_notes) <= 2000),
  damage_cost       numeric(10,2) CHECK (damage_cost IS NULL OR damage_cost >= 0),
  damage_currency   varchar(3)  CHECK (damage_currency IS NULL OR damage_currency ~ '^[A-Z]{3}$'),
  allocated_by      uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  dispatched_by     uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  received_by       uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  notes             text        CHECK (notes IS NULL OR length(notes) <= 4000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity_damaged + quantity_lost + quantity_returned <= quantity),
  CHECK ((damage_cost IS NULL) = (damage_currency IS NULL)),
  CHECK (damage_cost IS NULL OR quantity_damaged > 0),
  CHECK (status <> 'dispatched' OR dispatched_at IS NOT NULL),
  CHECK (status <> 'returned'   OR (dispatched_at IS NOT NULL AND returned_at IS NOT NULL)),
  CHECK (status <> 'damaged'    OR (quantity_damaged > 0 AND damage_notes IS NOT NULL)),
  CHECK (status <> 'lost'       OR quantity_lost > 0),
  CHECK (status <> 'cancelled'  OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
  CHECK (returned_at IS NULL OR (dispatched_at IS NOT NULL AND returned_at >= dispatched_at)),
  CHECK (dispatched_at IS NULL OR dispatched_at >= allocated_at)
);

CREATE INDEX idx_inv_alloc_item     ON inventory_allocations (inventory_item_id);
CREATE INDEX idx_inv_alloc_event    ON inventory_allocations (event_id);
CREATE INDEX idx_inv_alloc_tenant   ON inventory_allocations (tenant_id);
CREATE INDEX idx_inv_alloc_status   ON inventory_allocations (event_id, status);
CREATE INDEX idx_inv_alloc_active   ON inventory_allocations (inventory_item_id) WHERE status IN ('allocated','dispatched');

CREATE OR REPLACE FUNCTION inventory_allocations_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE item_tenant uuid; event_tenant uuid; ab_tenant uuid; db_tenant uuid; rb_tenant uuid;
BEGIN
  SELECT tenant_id INTO item_tenant FROM inventory_items WHERE id = NEW.inventory_item_id;
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF item_tenant IS NULL OR event_tenant IS NULL THEN
    RAISE EXCEPTION 'inventory_allocations parent rows not found' USING ERRCODE = '23503';
  END IF;
  IF item_tenant <> NEW.tenant_id OR event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'inventory_allocations.tenant_id % does not match item/event tenants', NEW.tenant_id USING ERRCODE = '23514';
  END IF;
  IF NEW.allocated_by IS NOT NULL THEN
    SELECT tenant_id INTO ab_tenant FROM tenant_members WHERE id = NEW.allocated_by;
    IF ab_tenant IS NULL OR ab_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'inventory_allocations.allocated_by % does not belong to tenant %', NEW.allocated_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.dispatched_by IS NOT NULL THEN
    SELECT tenant_id INTO db_tenant FROM tenant_members WHERE id = NEW.dispatched_by;
    IF db_tenant IS NULL OR db_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'inventory_allocations.dispatched_by % does not belong to tenant %', NEW.dispatched_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.received_by IS NOT NULL THEN
    SELECT tenant_id INTO rb_tenant FROM tenant_members WHERE id = NEW.received_by;
    IF rb_tenant IS NULL OR rb_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'inventory_allocations.received_by % does not belong to tenant %', NEW.received_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventory_allocations_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, inventory_item_id, event_id, allocated_by, dispatched_by, received_by ON inventory_allocations
  FOR EACH ROW EXECUTE FUNCTION inventory_allocations_check_tenant_match();

ALTER TABLE inventory_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_allocations FORCE ROW LEVEL SECURITY;
