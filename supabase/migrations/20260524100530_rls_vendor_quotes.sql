-- Phase 12 Unit 101a: RLS on vendor_quotes.
-- Direct tenant_id + vendor-self lane. Both tenant_members
-- and the vendor can SELECT/INSERT/UPDATE quotes for an
-- assignment. Manager-gated DELETE.
DROP POLICY IF EXISTS vq_select_member       ON vendor_quotes;
DROP POLICY IF EXISTS vq_select_vendor       ON vendor_quotes;
DROP POLICY IF EXISTS vq_select_super_admin  ON vendor_quotes;
DROP POLICY IF EXISTS vq_insert_member       ON vendor_quotes;
DROP POLICY IF EXISTS vq_insert_vendor       ON vendor_quotes;
DROP POLICY IF EXISTS vq_insert_super_admin  ON vendor_quotes;
DROP POLICY IF EXISTS vq_update_member       ON vendor_quotes;
DROP POLICY IF EXISTS vq_update_vendor       ON vendor_quotes;
DROP POLICY IF EXISTS vq_update_super_admin  ON vendor_quotes;
DROP POLICY IF EXISTS vq_delete_manager      ON vendor_quotes;
DROP POLICY IF EXISTS vq_delete_super_admin  ON vendor_quotes;
CREATE POLICY vq_select_member ON vendor_quotes FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY vq_select_vendor ON vendor_quotes FOR SELECT USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vq_select_super_admin ON vendor_quotes FOR SELECT USING (is_super_admin());
CREATE POLICY vq_insert_member ON vendor_quotes FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY vq_insert_vendor ON vendor_quotes FOR INSERT WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vq_insert_super_admin ON vendor_quotes FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vq_update_member ON vendor_quotes FOR UPDATE USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY vq_update_vendor ON vendor_quotes FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vq_update_super_admin ON vendor_quotes FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vq_delete_manager ON vendor_quotes FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = vendor_quotes.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY vq_delete_super_admin ON vendor_quotes FOR DELETE USING (is_super_admin());
