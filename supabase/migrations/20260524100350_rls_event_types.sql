-- Phase 12 Unit 70: RLS policies on event_types.
--
-- event_types is dual-scope per the Phase 1 CHECK:
--   system row : tenant_id IS NULL AND is_system = TRUE
--   tenant row : tenant_id IS NOT NULL AND is_system = FALSE
--
-- System rows are the platform-managed catalogue
-- (Wedding/Conference/etc.) seeded in Phase 12. They are
-- VISIBLE to any authenticated caller because tenant
-- onboarding lets a member pick from this catalogue. They
-- are MANAGED only by Super Admins.
--
-- Tenant rows are custom event types created by a tenant
-- (per-tenant flavours of the platform catalogue or fully
-- custom types). They follow the standard
-- owner/event_manager INSERT/UPDATE/DELETE shape with
-- tenant_member SELECT.

DROP POLICY IF EXISTS et_select_system        ON event_types;
DROP POLICY IF EXISTS et_select_tenant_member ON event_types;
DROP POLICY IF EXISTS et_select_super_admin   ON event_types;
DROP POLICY IF EXISTS et_insert_super_admin   ON event_types;
DROP POLICY IF EXISTS et_insert_manager       ON event_types;
DROP POLICY IF EXISTS et_update_super_admin   ON event_types;
DROP POLICY IF EXISTS et_update_manager       ON event_types;
DROP POLICY IF EXISTS et_delete_super_admin   ON event_types;
DROP POLICY IF EXISTS et_delete_manager       ON event_types;

CREATE POLICY et_select_system ON event_types
  FOR SELECT USING (tenant_id IS NULL AND is_system = TRUE AND is_authenticated());

CREATE POLICY et_select_tenant_member ON event_types
  FOR SELECT USING (tenant_id IS NOT NULL AND is_tenant_member(tenant_id));

CREATE POLICY et_select_super_admin ON event_types
  FOR SELECT USING (is_super_admin());

CREATE POLICY et_insert_super_admin ON event_types
  FOR INSERT WITH CHECK (
    tenant_id IS NULL AND is_system = TRUE AND is_super_admin()
  );

CREATE POLICY et_insert_manager ON event_types
  FOR INSERT WITH CHECK (
    tenant_id IS NOT NULL AND is_system = FALSE AND EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = event_types.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  );

CREATE POLICY et_update_super_admin ON event_types
  FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY et_update_manager ON event_types
  FOR UPDATE
  USING (
    tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = event_types.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  )
  WITH CHECK (
    tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = event_types.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  );

CREATE POLICY et_delete_super_admin ON event_types
  FOR DELETE USING (is_super_admin());

CREATE POLICY et_delete_manager ON event_types
  FOR DELETE USING (
    tenant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = event_types.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  );
