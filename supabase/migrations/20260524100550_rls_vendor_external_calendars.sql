-- Phase 12 Unit 102a: vendor_external_calendars. Vendor-only.
DROP POLICY IF EXISTS vec_select_vendor       ON vendor_external_calendars;
DROP POLICY IF EXISTS vec_select_super_admin  ON vendor_external_calendars;
DROP POLICY IF EXISTS vec_insert_vendor       ON vendor_external_calendars;
DROP POLICY IF EXISTS vec_insert_super_admin  ON vendor_external_calendars;
DROP POLICY IF EXISTS vec_update_vendor       ON vendor_external_calendars;
DROP POLICY IF EXISTS vec_update_super_admin  ON vendor_external_calendars;
DROP POLICY IF EXISTS vec_delete_vendor       ON vendor_external_calendars;
DROP POLICY IF EXISTS vec_delete_super_admin  ON vendor_external_calendars;
CREATE POLICY vec_select_vendor ON vendor_external_calendars FOR SELECT USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vec_select_super_admin ON vendor_external_calendars FOR SELECT USING (is_super_admin());
CREATE POLICY vec_insert_vendor ON vendor_external_calendars FOR INSERT WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vec_insert_super_admin ON vendor_external_calendars FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vec_update_vendor ON vendor_external_calendars FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vec_update_super_admin ON vendor_external_calendars FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vec_delete_vendor ON vendor_external_calendars FOR DELETE USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vec_delete_super_admin ON vendor_external_calendars FOR DELETE USING (is_super_admin());
