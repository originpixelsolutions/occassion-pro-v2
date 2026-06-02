-- Phase 12 Unit 87: RLS on vendor_event_assignments.
-- Cross-tenant link table - ships BEFORE vendor_accounts.
-- tenant_member SELECT/INSERT (manager-gated)/UPDATE/DELETE
-- on own tenant's links; vendor SELECT/UPDATE on own links
-- (accept/decline); super_admin override.
DROP POLICY IF EXISTS vea_select_member       ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_select_vendor       ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_select_super_admin  ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_insert_manager      ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_insert_super_admin  ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_update_manager      ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_update_vendor       ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_update_super_admin  ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_delete_manager      ON vendor_event_assignments;
DROP POLICY IF EXISTS vea_delete_super_admin  ON vendor_event_assignments;

CREATE POLICY vea_select_member ON vendor_event_assignments FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY vea_select_vendor ON vendor_event_assignments FOR SELECT USING (
  vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vea_select_super_admin ON vendor_event_assignments FOR SELECT USING (is_super_admin());

CREATE POLICY vea_insert_manager ON vendor_event_assignments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = vendor_event_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY vea_insert_super_admin ON vendor_event_assignments FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY vea_update_manager ON vendor_event_assignments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = vendor_event_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = vendor_event_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY vea_update_vendor ON vendor_event_assignments FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vea_update_super_admin ON vendor_event_assignments FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY vea_delete_manager ON vendor_event_assignments FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = vendor_event_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY vea_delete_super_admin ON vendor_event_assignments FOR DELETE USING (is_super_admin());
