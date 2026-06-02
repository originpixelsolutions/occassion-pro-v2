-- Phase 12 Unit 101c: RLS on vendor_invoice_templates.
-- Vendor-owned exclusively. Only the vendor themselves
-- manages templates.
DROP POLICY IF EXISTS vit_select_vendor       ON vendor_invoice_templates;
DROP POLICY IF EXISTS vit_select_super_admin  ON vendor_invoice_templates;
DROP POLICY IF EXISTS vit_insert_vendor       ON vendor_invoice_templates;
DROP POLICY IF EXISTS vit_insert_super_admin  ON vendor_invoice_templates;
DROP POLICY IF EXISTS vit_update_vendor       ON vendor_invoice_templates;
DROP POLICY IF EXISTS vit_update_super_admin  ON vendor_invoice_templates;
DROP POLICY IF EXISTS vit_delete_vendor       ON vendor_invoice_templates;
DROP POLICY IF EXISTS vit_delete_super_admin  ON vendor_invoice_templates;
CREATE POLICY vit_select_vendor ON vendor_invoice_templates FOR SELECT USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vit_select_super_admin ON vendor_invoice_templates FOR SELECT USING (is_super_admin());
CREATE POLICY vit_insert_vendor ON vendor_invoice_templates FOR INSERT WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vit_insert_super_admin ON vendor_invoice_templates FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vit_update_vendor ON vendor_invoice_templates FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vit_update_super_admin ON vendor_invoice_templates FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vit_delete_vendor ON vendor_invoice_templates FOR DELETE USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vit_delete_super_admin ON vendor_invoice_templates FOR DELETE USING (is_super_admin());
