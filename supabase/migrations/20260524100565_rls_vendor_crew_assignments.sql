-- Phase 12 Unit 102d: vendor_crew_assignments. Vendor-owned
-- (CRUD). Linked-tenant member can SELECT to see who is
-- on the vendor crew roster for their event. Direct
-- tenant_id and vendor_account_id on the row simplify the
-- policy (no join required).
DROP POLICY IF EXISTS vca_select_vendor       ON vendor_crew_assignments;
DROP POLICY IF EXISTS vca_select_member       ON vendor_crew_assignments;
DROP POLICY IF EXISTS vca_select_super_admin  ON vendor_crew_assignments;
DROP POLICY IF EXISTS vca_insert_vendor       ON vendor_crew_assignments;
DROP POLICY IF EXISTS vca_insert_super_admin  ON vendor_crew_assignments;
DROP POLICY IF EXISTS vca_update_vendor       ON vendor_crew_assignments;
DROP POLICY IF EXISTS vca_update_super_admin  ON vendor_crew_assignments;
DROP POLICY IF EXISTS vca_delete_vendor       ON vendor_crew_assignments;
DROP POLICY IF EXISTS vca_delete_super_admin  ON vendor_crew_assignments;
CREATE POLICY vca_select_vendor ON vendor_crew_assignments FOR SELECT USING (
  vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vca_select_member ON vendor_crew_assignments FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY vca_select_super_admin ON vendor_crew_assignments FOR SELECT USING (is_super_admin());
CREATE POLICY vca_insert_vendor ON vendor_crew_assignments FOR INSERT WITH CHECK (
  vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vca_insert_super_admin ON vendor_crew_assignments FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vca_update_vendor ON vendor_crew_assignments FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vca_update_super_admin ON vendor_crew_assignments FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vca_delete_vendor ON vendor_crew_assignments FOR DELETE USING (
  vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vca_delete_super_admin ON vendor_crew_assignments FOR DELETE USING (is_super_admin());
