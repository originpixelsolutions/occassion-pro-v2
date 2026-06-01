-- Phase 3 Unit 29: inventory_items (spec line 2329).
-- Tenant-wide reusable inventory: tables, chairs, decor, AV,
-- lighting, kitchen, linen, crockery, signage. Per-tenant
-- (not per-event) because items are shared across many events
-- through inventory_allocations.
--
-- Quantity invariant: in_stock + in_use + damaged <= total.
-- An item with 100 total can have at most 100 distributed
-- across the three states; the remainder (typically 0) is
-- reserved/pending.
--
-- Cost columns (unit_cost, unit_replacement_cost) paired with
-- currency_code via a coupling CHECK (any cost requires
-- currency, but currency may exist without cost for newly-
-- catalogued items awaiting pricing).
--
-- SKU is partial-UNIQUE per tenant (case-insensitive) WHERE
-- not soft-deleted; two items can share NULL SKU but not the
-- same SKU. status enum: active/retired. retired_at coupled
-- to status='retired'.

CREATE TABLE inventory_items (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  category              text        CHECK (category IS NULL OR category IN ('tables','chairs','decor','av','lighting','kitchen','linen','crockery','signage','other')),
  sku                   text        CHECK (sku IS NULL OR sku ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,58}[A-Za-z0-9]$'),
  description           text        CHECK (description IS NULL OR length(description) <= 4000),
  unit_cost             numeric(10,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  unit_replacement_cost numeric(10,2) CHECK (unit_replacement_cost IS NULL OR unit_replacement_cost >= 0),
  currency_code         varchar(3)  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  quantity_total        integer     NOT NULL DEFAULT 0 CHECK (quantity_total >= 0),
  quantity_in_stock     integer     NOT NULL DEFAULT 0 CHECK (quantity_in_stock >= 0),
  quantity_in_use       integer     NOT NULL DEFAULT 0 CHECK (quantity_in_use >= 0),
  quantity_damaged      integer     NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  storage_location      text        CHECK (storage_location IS NULL OR length(storage_location) BETWEEN 1 AND 200),
  image_url             text        CHECK (image_url IS NULL OR (image_url ~ '^https://' AND length(image_url) BETWEEN 1 AND 2048)),
  status                text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  retired_at            timestamptz,
  retired_reason        text        CHECK (retired_reason IS NULL OR length(retired_reason) <= 1000),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  purge_after           timestamptz,
  CHECK (quantity_in_stock + quantity_in_use + quantity_damaged <= quantity_total),
  CHECK ((unit_cost IS NULL AND unit_replacement_cost IS NULL) OR currency_code IS NOT NULL),
  CHECK (status <> 'retired' OR retired_at IS NOT NULL),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_inventory_items_sku
  ON inventory_items (tenant_id, lower(sku))
  WHERE sku IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_inventory_tenant     ON inventory_items (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_inventory_category   ON inventory_items (tenant_id, category) WHERE category IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_inventory_name       ON inventory_items (tenant_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_inventory_purge_due  ON inventory_items (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
