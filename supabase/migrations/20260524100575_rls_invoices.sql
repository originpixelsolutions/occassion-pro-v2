-- Phase 12 Unit 104a: RLS on invoices. tenant_member full
-- read; client SELECT own; manager-gated INSERT; tenant_member
-- UPDATE (status transitions); no DELETE except super_admin
-- (financial records).
DROP POLICY IF EXISTS inv2_select_member       ON invoices;
DROP POLICY IF EXISTS inv2_select_client       ON invoices;
DROP POLICY IF EXISTS inv2_select_super_admin  ON invoices;
DROP POLICY IF EXISTS inv2_insert_manager      ON invoices;
DROP POLICY IF EXISTS inv2_insert_super_admin  ON invoices;
DROP POLICY IF EXISTS inv2_update_member       ON invoices;
DROP POLICY IF EXISTS inv2_update_super_admin  ON invoices;
DROP POLICY IF EXISTS inv2_delete_super_admin  ON invoices;
CREATE POLICY inv2_select_member ON invoices FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY inv2_select_client ON invoices FOR SELECT USING (client_account_id = current_user_id() AND current_user_type() = 'client');
CREATE POLICY inv2_select_super_admin ON invoices FOR SELECT USING (is_super_admin());
CREATE POLICY inv2_insert_manager ON invoices FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = invoices.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY inv2_insert_super_admin ON invoices FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY inv2_update_member ON invoices FOR UPDATE USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY inv2_update_super_admin ON invoices FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY inv2_delete_super_admin ON invoices FOR DELETE USING (is_super_admin());
