-- Phase 12 Unit 99a: RLS on inventory_items. Canonical
-- tenant_id-direct (events template).
DROP POLICY IF EXISTS ii_select_member       ON inventory_items;
DROP POLICY IF EXISTS ii_select_super_admin  ON inventory_items;
DROP POLICY IF EXISTS ii_insert_manager      ON inventory_items;
DROP POLICY IF EXISTS ii_insert_super_admin  ON inventory_items;
DROP POLICY IF EXISTS ii_update_member       ON inventory_items;
DROP POLICY IF EXISTS ii_update_super_admin  ON inventory_items;
DROP POLICY IF EXISTS ii_delete_manager      ON inventory_items;
DROP POLICY IF EXISTS ii_delete_super_admin  ON inventory_items;
CREATE POLICY ii_select_member ON inventory_items FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY ii_select_super_admin ON inventory_items FOR SELECT USING (is_super_admin());
CREATE POLICY ii_insert_manager ON inventory_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = inventory_items.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY ii_insert_super_admin ON inventory_items FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY ii_update_member ON inventory_items FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY ii_update_super_admin ON inventory_items FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY ii_delete_manager ON inventory_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = inventory_items.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY ii_delete_super_admin ON inventory_items FOR DELETE USING (is_super_admin());
