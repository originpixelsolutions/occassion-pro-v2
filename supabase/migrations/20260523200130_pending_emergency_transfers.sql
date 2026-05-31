-- Phase 2 Unit 27: pending_emergency_transfers (spec 2.5).
-- Emergency workspace-owner transfer when the current owner is
-- incapacitated. Dispute window must elapse before completion;
-- terminal states (completed/cancelled) are mutually exclusive;
-- one open transfer per tenant at a time.

CREATE TABLE pending_emergency_transfers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  current_owner_id    uuid        NOT NULL REFERENCES tenant_members (id) ON DELETE RESTRICT,
  proposed_owner_id   uuid        NOT NULL REFERENCES tenant_members (id) ON DELETE RESTRICT,
  reason              text        NOT NULL CHECK (length(trim(reason)) BETWEEN 20 AND 2000),
  evidence_url        text        CHECK (evidence_url IS NULL OR evidence_url ~ '^https://'),
  initiated_by_admin  uuid        NOT NULL REFERENCES super_admins (id) ON DELETE RESTRICT,
  initiated_at        timestamptz NOT NULL DEFAULT now(),
  dispute_window_end  timestamptz NOT NULL,
  disputed_at         timestamptz,
  dispute_channel     text        CHECK (dispute_channel IS NULL OR dispute_channel IN ('email','phone','support_ticket','legal_notice','other')),
  dispute_reason      text        CHECK (dispute_reason IS NULL OR length(dispute_reason) <= 2000),
  completed_at        timestamptz,
  completed_by        uuid        REFERENCES super_admins (id) ON DELETE SET NULL,
  cancelled_at        timestamptz,
  cancelled_by        uuid        REFERENCES super_admins (id) ON DELETE SET NULL,
  reversed_at         timestamptz,
  reversed_by         uuid        REFERENCES super_admins (id) ON DELETE SET NULL,
  CHECK (current_owner_id <> proposed_owner_id),
  CHECK (dispute_window_end > initiated_at),
  CHECK (((completed_at IS NOT NULL)::int + (cancelled_at IS NOT NULL)::int) <= 1),
  CHECK (completed_at IS NULL OR completed_by IS NOT NULL),
  CHECK (cancelled_at IS NULL OR cancelled_by IS NOT NULL),
  CHECK (reversed_at  IS NULL OR (completed_at IS NOT NULL AND reversed_by IS NOT NULL)),
  CHECK (disputed_at  IS NULL OR dispute_channel IS NOT NULL),
  CHECK (completed_at IS NULL OR completed_at >= dispute_window_end)
);

CREATE UNIQUE INDEX one_pending_transfer_per_tenant
  ON pending_emergency_transfers (tenant_id)
  WHERE completed_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX idx_pet_tenant             ON pending_emergency_transfers (tenant_id);
CREATE INDEX idx_pet_current_owner      ON pending_emergency_transfers (current_owner_id);
CREATE INDEX idx_pet_proposed_owner     ON pending_emergency_transfers (proposed_owner_id);
CREATE INDEX idx_pet_initiated_by_admin ON pending_emergency_transfers (initiated_by_admin);
CREATE INDEX idx_pet_dispute_window     ON pending_emergency_transfers (dispute_window_end) WHERE completed_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE pending_emergency_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_emergency_transfers FORCE ROW LEVEL SECURITY;
