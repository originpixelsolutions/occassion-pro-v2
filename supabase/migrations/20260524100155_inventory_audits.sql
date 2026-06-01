-- Phase 3 Unit 31: inventory_audits (spec line 2371).
-- Quarterly per-tenant inventory audit snapshots. State
-- machine: in_progress -> completed | cancelled.
--
-- audit_type enum: periodic (quarterly), spot_check (random),
-- post_event (after a big event), annual (year-end), triggered
-- (alert-driven).
--
-- Per-state prereq CHECKs:
--   completed : completed_at AND snapshot NOT NULL
--   cancelled : cancelled_at AND cancelled_reason NOT NULL
--
-- snapshot jsonb (<4 MiB pg_column_size, must be object) holds
-- the per-item count summary. discrepancies jsonb (<1 MiB) holds
-- the diff against expected counts. Both shape-checked with
-- jsonb_typeof to prevent arrays / scalars.
--
-- total_value_audited paired with currency_code via two-way
-- coupling. discrepancy_count denormalized for fast 'audits
-- with issues' filtering via the partial index.
--
-- Cross-tenant trigger validates audited_by member belongs to
-- the audit's tenant.

CREATE TABLE inventory_audits (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  audited_at             timestamptz NOT NULL DEFAULT now(),
  audited_by             uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  audit_type             text        NOT NULL DEFAULT 'periodic' CHECK (audit_type IN ('periodic','spot_check','post_event','annual','triggered')),
  status                 text        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','cancelled')),
  snapshot               jsonb       CHECK (snapshot IS NULL OR (jsonb_typeof(snapshot) = 'object' AND pg_column_size(snapshot) < 4194304)),
  discrepancies          jsonb       CHECK (discrepancies IS NULL OR (jsonb_typeof(discrepancies) = 'object' AND pg_column_size(discrepancies) < 1048576)),
  item_count             integer     CHECK (item_count IS NULL OR item_count >= 0),
  discrepancy_count      integer     NOT NULL DEFAULT 0 CHECK (discrepancy_count >= 0),
  total_value_audited    numeric(14,2) CHECK (total_value_audited IS NULL OR total_value_audited >= 0),
  total_value_currency   varchar(3)  CHECK (total_value_currency IS NULL OR total_value_currency ~ '^[A-Z]{3}$'),
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  cancelled_reason       text        CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 1000),
  notes                  text        CHECK (notes IS NULL OR length(notes) <= 8000),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'completed' OR (completed_at IS NOT NULL AND snapshot IS NOT NULL)),
  CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
  CHECK ((total_value_audited IS NULL) = (total_value_currency IS NULL)),
  CHECK (completed_at IS NULL OR completed_at >= audited_at),
  CHECK (cancelled_at IS NULL OR cancelled_at >= audited_at)
);

CREATE INDEX idx_inventory_audits_tenant_time ON inventory_audits (tenant_id, audited_at DESC);
CREATE INDEX idx_inventory_audits_status      ON inventory_audits (tenant_id, status) WHERE status <> 'cancelled';
CREATE INDEX idx_inventory_audits_auditor     ON inventory_audits (audited_by) WHERE audited_by IS NOT NULL;
CREATE INDEX idx_inventory_audits_discrepant  ON inventory_audits (tenant_id, audited_at DESC) WHERE discrepancy_count > 0;

CREATE OR REPLACE FUNCTION inventory_audits_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE auditor_tenant uuid;
BEGIN
  IF NEW.audited_by IS NOT NULL THEN
    SELECT tenant_id INTO auditor_tenant FROM tenant_members WHERE id = NEW.audited_by;
    IF auditor_tenant IS NULL OR auditor_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'inventory_audits.audited_by % does not belong to tenant %', NEW.audited_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventory_audits_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, audited_by ON inventory_audits
  FOR EACH ROW EXECUTE FUNCTION inventory_audits_check_tenant_match();

ALTER TABLE inventory_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_audits FORCE ROW LEVEL SECURITY;
