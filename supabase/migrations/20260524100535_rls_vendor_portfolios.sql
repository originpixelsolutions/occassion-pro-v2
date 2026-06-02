-- Phase 12 Unit 101b: RLS on vendor_portfolios.
-- Public-discovery: portfolios are visible to anyone (the
-- vendor marketplace). Only the vendor manages own.
DROP POLICY IF EXISTS vp_select_public        ON vendor_portfolios;
DROP POLICY IF EXISTS vp_select_vendor        ON vendor_portfolios;
DROP POLICY IF EXISTS vp_select_super_admin   ON vendor_portfolios;
DROP POLICY IF EXISTS vp_insert_vendor        ON vendor_portfolios;
DROP POLICY IF EXISTS vp_insert_super_admin   ON vendor_portfolios;
DROP POLICY IF EXISTS vp_update_vendor        ON vendor_portfolios;
DROP POLICY IF EXISTS vp_update_super_admin   ON vendor_portfolios;
DROP POLICY IF EXISTS vp_delete_vendor        ON vendor_portfolios;
DROP POLICY IF EXISTS vp_delete_super_admin   ON vendor_portfolios;
CREATE POLICY vp_select_public ON vendor_portfolios FOR SELECT USING (TRUE);
CREATE POLICY vp_select_vendor ON vendor_portfolios FOR SELECT USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vp_select_super_admin ON vendor_portfolios FOR SELECT USING (is_super_admin());
CREATE POLICY vp_insert_vendor ON vendor_portfolios FOR INSERT WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vp_insert_super_admin ON vendor_portfolios FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vp_update_vendor ON vendor_portfolios FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vp_update_super_admin ON vendor_portfolios FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vp_delete_vendor ON vendor_portfolios FOR DELETE USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vp_delete_super_admin ON vendor_portfolios FOR DELETE USING (is_super_admin());
