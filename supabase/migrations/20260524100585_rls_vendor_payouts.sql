-- Phase 12 Unit 104c: RLS on vendor_payouts.
-- tenant_member SELECT (for the booking org's view of
-- payments to vendor); vendor SELECT own; super_admin
-- writes (platform-managed payout pipeline).
DROP POLICY IF EXISTS vpay_select_member       ON vendor_payouts;
DROP POLICY IF EXISTS vpay_select_vendor       ON vendor_payouts;
DROP POLICY IF EXISTS vpay_select_super_admin  ON vendor_payouts;
DROP POLICY IF EXISTS vpay_insert_super_admin  ON vendor_payouts;
DROP POLICY IF EXISTS vpay_update_super_admin  ON vendor_payouts;
DROP POLICY IF EXISTS vpay_delete_super_admin  ON vendor_payouts;
CREATE POLICY vpay_select_member ON vendor_payouts FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY vpay_select_vendor ON vendor_payouts FOR SELECT USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vpay_select_super_admin ON vendor_payouts FOR SELECT USING (is_super_admin());
CREATE POLICY vpay_insert_super_admin ON vendor_payouts FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vpay_update_super_admin ON vendor_payouts FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vpay_delete_super_admin ON vendor_payouts FOR DELETE USING (is_super_admin());
