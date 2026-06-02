-- Phase 12 Unit 102b: vendor_calendar_events. Vendor-only.
DROP POLICY IF EXISTS vce_select_vendor       ON vendor_calendar_events;
DROP POLICY IF EXISTS vce_select_super_admin  ON vendor_calendar_events;
DROP POLICY IF EXISTS vce_insert_vendor       ON vendor_calendar_events;
DROP POLICY IF EXISTS vce_insert_super_admin  ON vendor_calendar_events;
DROP POLICY IF EXISTS vce_update_vendor       ON vendor_calendar_events;
DROP POLICY IF EXISTS vce_update_super_admin  ON vendor_calendar_events;
DROP POLICY IF EXISTS vce_delete_vendor       ON vendor_calendar_events;
DROP POLICY IF EXISTS vce_delete_super_admin  ON vendor_calendar_events;
CREATE POLICY vce_select_vendor ON vendor_calendar_events FOR SELECT USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vce_select_super_admin ON vendor_calendar_events FOR SELECT USING (is_super_admin());
CREATE POLICY vce_insert_vendor ON vendor_calendar_events FOR INSERT WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vce_insert_super_admin ON vendor_calendar_events FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vce_update_vendor ON vendor_calendar_events FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vce_update_super_admin ON vendor_calendar_events FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vce_delete_vendor ON vendor_calendar_events FOR DELETE USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vce_delete_super_admin ON vendor_calendar_events FOR DELETE USING (is_super_admin());
