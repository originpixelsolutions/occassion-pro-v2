-- Phase 12 Unit 102c: vendor_crew_members. Vendor-only.
DROP POLICY IF EXISTS vcm_select_vendor       ON vendor_crew_members;
DROP POLICY IF EXISTS vcm_select_super_admin  ON vendor_crew_members;
DROP POLICY IF EXISTS vcm_insert_vendor       ON vendor_crew_members;
DROP POLICY IF EXISTS vcm_insert_super_admin  ON vendor_crew_members;
DROP POLICY IF EXISTS vcm_update_vendor       ON vendor_crew_members;
DROP POLICY IF EXISTS vcm_update_super_admin  ON vendor_crew_members;
DROP POLICY IF EXISTS vcm_delete_vendor       ON vendor_crew_members;
DROP POLICY IF EXISTS vcm_delete_super_admin  ON vendor_crew_members;
CREATE POLICY vcm_select_vendor ON vendor_crew_members FOR SELECT USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vcm_select_super_admin ON vendor_crew_members FOR SELECT USING (is_super_admin());
CREATE POLICY vcm_insert_vendor ON vendor_crew_members FOR INSERT WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vcm_insert_super_admin ON vendor_crew_members FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vcm_update_vendor ON vendor_crew_members FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vcm_update_super_admin ON vendor_crew_members FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vcm_delete_vendor ON vendor_crew_members FOR DELETE USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vcm_delete_super_admin ON vendor_crew_members FOR DELETE USING (is_super_admin());
