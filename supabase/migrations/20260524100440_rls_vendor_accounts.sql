-- Phase 12 Unit 88: RLS on vendor_accounts. Cross-tenant
-- identity (8th template). self + linked-tenant-member.
DROP POLICY IF EXISTS va_select_self          ON vendor_accounts;
DROP POLICY IF EXISTS va_select_super_admin   ON vendor_accounts;
DROP POLICY IF EXISTS va_select_linked_member ON vendor_accounts;
DROP POLICY IF EXISTS va_insert_self_signup   ON vendor_accounts;
DROP POLICY IF EXISTS va_insert_super_admin   ON vendor_accounts;
DROP POLICY IF EXISTS va_update_self          ON vendor_accounts;
DROP POLICY IF EXISTS va_update_super_admin   ON vendor_accounts;
DROP POLICY IF EXISTS va_delete_super_admin   ON vendor_accounts;

CREATE POLICY va_select_self ON vendor_accounts
  FOR SELECT USING (id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY va_select_super_admin ON vendor_accounts
  FOR SELECT USING (is_super_admin());
CREATE POLICY va_select_linked_member ON vendor_accounts FOR SELECT USING (
  EXISTS (SELECT 1 FROM vendor_event_assignments vea
    WHERE vea.vendor_account_id = vendor_accounts.id
      AND is_tenant_member(vea.tenant_id)
      AND vea.cancelled_at IS NULL));

CREATE POLICY va_insert_self_signup ON vendor_accounts FOR INSERT WITH CHECK (current_user_id() IS NULL);
CREATE POLICY va_insert_super_admin ON vendor_accounts FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY va_update_self ON vendor_accounts FOR UPDATE
  USING (id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY va_update_super_admin ON vendor_accounts FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY va_delete_super_admin ON vendor_accounts FOR DELETE USING (is_super_admin());
