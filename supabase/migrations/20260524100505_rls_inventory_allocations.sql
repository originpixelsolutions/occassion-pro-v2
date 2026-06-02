-- Phase 12 Unit 99b: RLS on inventory_allocations. Direct
-- tenant_id with broad INSERT/UPDATE (operational flow);
-- manager-gated DELETE.
DROP POLICY IF EXISTS ia_select_member       ON inventory_allocations;
DROP POLICY IF EXISTS ia_select_super_admin  ON inventory_allocations;
DROP POLICY IF EXISTS ia_insert_member       ON inventory_allocations;
DROP POLICY IF EXISTS ia_insert_super_admin  ON inventory_allocations;
DROP POLICY IF EXISTS ia_update_member       ON inventory_allocations;
DROP POLICY IF EXISTS ia_update_super_admin  ON inventory_allocations;
DROP POLICY IF EXISTS ia_delete_manager      ON inventory_allocations;
DROP POLICY IF EXISTS ia_delete_super_admin  ON inventory_allocations;
CREATE POLICY ia_select_member ON inventory_allocations FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY ia_select_super_admin ON inventory_allocations FOR SELECT USING (is_super_admin());
CREATE POLICY ia_insert_member ON inventory_allocations FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY ia_insert_super_admin ON inventory_allocations FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY ia_update_member ON inventory_allocations FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY ia_update_super_admin ON inventory_allocations FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY ia_delete_manager ON inventory_allocations FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = inventory_allocations.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY ia_delete_super_admin ON inventory_allocations FOR DELETE USING (is_super_admin());
