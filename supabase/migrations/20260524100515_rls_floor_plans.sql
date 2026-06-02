-- Phase 12 Unit 100a: RLS on floor_plans. Canonical
-- tenant_id-direct (events template).
DROP POLICY IF EXISTS fp_select_member       ON floor_plans;
DROP POLICY IF EXISTS fp_select_super_admin  ON floor_plans;
DROP POLICY IF EXISTS fp_insert_manager      ON floor_plans;
DROP POLICY IF EXISTS fp_insert_super_admin  ON floor_plans;
DROP POLICY IF EXISTS fp_update_member       ON floor_plans;
DROP POLICY IF EXISTS fp_update_super_admin  ON floor_plans;
DROP POLICY IF EXISTS fp_delete_manager      ON floor_plans;
DROP POLICY IF EXISTS fp_delete_super_admin  ON floor_plans;

CREATE POLICY fp_select_member ON floor_plans FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY fp_select_super_admin ON floor_plans FOR SELECT USING (is_super_admin());
CREATE POLICY fp_insert_manager ON floor_plans FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = floor_plans.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY fp_insert_super_admin ON floor_plans FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY fp_update_member ON floor_plans FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY fp_update_super_admin ON floor_plans FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY fp_delete_manager ON floor_plans FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = floor_plans.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY fp_delete_super_admin ON floor_plans FOR DELETE USING (is_super_admin());
