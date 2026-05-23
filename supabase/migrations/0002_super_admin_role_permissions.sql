-- =====================================================================
-- 0002_super_admin_role_permissions | Phase 1 | Foundational
-- Spec refs: 2.9.1 (7 roles), 2.9.3 (permission matrix),
--            2.9.4 (two-person approval markers), 34.0 Phase 1.
-- Depends on: nothing. Sits alongside super_admins.
-- Seed data (the 23 capability x 7 role matrix) lands in Phase 12.
-- =====================================================================

CREATE TABLE super_admin_role_permissions (
  role            text        NOT NULL
                              CHECK (role IN (
                                'owner','admin','engineering',
                                'support','sales','finance','auditor'
                              )),
  capability      text        NOT NULL CHECK (length(trim(capability)) > 0),

  -- Is the action allowed at all for this role?
  granted         boolean     NOT NULL DEFAULT false,

  -- Spec 2.9.4: ✓† in the matrix means the action requires two-person
  -- approval (initiator + approver). Bypassed in Sole Operator Mode.
  needs_approval  boolean     NOT NULL DEFAULT false,

  -- Free-form qualifier from the matrix footnotes (e.g. 'incident',
  -- 'reason_required', 'self_limit_inr_50k', '<=admin'). Kept as text so
  -- additional qualifiers can be added without schema migrations.
  conditional     text,

  -- Human-readable note for the audit / admin UI.
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (role, capability)
);

-- "Which roles can do X?" lookup. Partial — only granted rows matter.
CREATE INDEX idx_sarp_capability_granted
  ON super_admin_role_permissions (capability)
  WHERE granted = true;

-- "Which capabilities for this role require approval?"
CREATE INDEX idx_sarp_role_needs_approval
  ON super_admin_role_permissions (role)
  WHERE granted = true AND needs_approval = true;

CREATE OR REPLACE FUNCTION sarp_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_sarp_updated_at
  BEFORE UPDATE ON super_admin_role_permissions
  FOR EACH ROW EXECUTE FUNCTION sarp_set_updated_at();

ALTER TABLE super_admin_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE super_admin_role_permissions FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE  super_admin_role_permissions             IS 'Permission matrix for super_admins (spec 2.9.3). Composite PK (role, capability). Rows seeded in Phase 12.';
COMMENT ON COLUMN super_admin_role_permissions.needs_approval IS 'Spec 2.9.4: true = two-person approval required (initiator + approver). Bypassed in Sole Operator Mode.';
COMMENT ON COLUMN super_admin_role_permissions.conditional IS 'Free-form qualifier from matrix footnotes; e.g. incident, reason_required, self_limit_inr_50k.';
