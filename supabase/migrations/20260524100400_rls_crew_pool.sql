-- Phase 12 Unit 80: RLS policies on crew_pool. Canonical
-- tenant_id-direct shape.
DROP POLICY IF EXISTS cp_select_member       ON crew_pool;
DROP POLICY IF EXISTS cp_select_super_admin  ON crew_pool;
DROP POLICY IF EXISTS cp_insert_manager      ON crew_pool;
DROP POLICY IF EXISTS cp_insert_super_admin  ON crew_pool;
DROP POLICY IF EXISTS cp_update_member       ON crew_pool;
DROP POLICY IF EXISTS cp_update_super_admin  ON crew_pool;
DROP POLICY IF EXISTS cp_delete_manager      ON crew_pool;
DROP POLICY IF EXISTS cp_delete_super_admin  ON crew_pool;

CREATE POLICY cp_select_member ON crew_pool FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY cp_select_super_admin ON crew_pool FOR SELECT USING (is_super_admin());
CREATE POLICY cp_insert_manager ON crew_pool FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = crew_pool.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY cp_insert_super_admin ON crew_pool FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY cp_update_member ON crew_pool FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY cp_update_super_admin ON crew_pool FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY cp_delete_manager ON crew_pool FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = crew_pool.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY cp_delete_super_admin ON crew_pool FOR DELETE USING (is_super_admin());
