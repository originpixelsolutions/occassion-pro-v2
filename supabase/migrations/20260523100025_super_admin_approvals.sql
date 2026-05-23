-- 0006_super_admin_approvals | Phase 1 | spec 2.9.4 (two-person approval)
-- Depends on: super_admins.
CREATE TABLE super_admin_approvals (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type         text        NOT NULL CHECK (action_type IN (
                                    'force_purge','emergency_transfer','large_refund',
                                    'platform_secret_rotation','archive_plan',
                                    'role_change_to_admin_or_owner','pricing_override','plan_create'
                                  )),
  initiated_by        uuid        REFERENCES super_admins(id) ON DELETE RESTRICT,
  initiator_reason    text        NOT NULL CHECK (length(trim(initiator_reason)) > 0),
  target_entity_type  text,
  target_entity_id    uuid,
  proposed_changes    jsonb,
  approved_by         uuid        REFERENCES super_admins(id) ON DELETE RESTRICT,
  approver_reason     text,
  approved_at         timestamptz,
  rejected_at         timestamptz,
  rejected_reason     text,
  executed_at         timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (initiated_by IS NULL OR approved_by IS NULL OR initiated_by <> approved_by),
  CHECK (approved_at IS NULL OR rejected_at IS NULL),
  CHECK (approved_at IS NULL OR (approved_by IS NOT NULL AND approver_reason IS NOT NULL)),
  CHECK (rejected_at IS NULL OR rejected_reason IS NOT NULL),
  CHECK (executed_at IS NULL OR approved_at IS NOT NULL)
);
CREATE INDEX idx_sa_approvals_pending      ON super_admin_approvals (created_at)
  WHERE approved_at IS NULL AND rejected_at IS NULL AND executed_at IS NULL;
CREATE INDEX idx_sa_approvals_initiated_by ON super_admin_approvals (initiated_by);
CREATE INDEX idx_sa_approvals_approved_by  ON super_admin_approvals (approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX idx_sa_approvals_expires      ON super_admin_approvals (expires_at)
  WHERE approved_at IS NULL AND rejected_at IS NULL AND executed_at IS NULL;
ALTER TABLE super_admin_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admin_approvals FORCE ROW LEVEL SECURITY;
