-- Phase 12 Unit 104b: RLS on payments.
-- Gateway webhook (anon-with-signature) inserts; only
-- super_admin updates status/deletes (workers run as
-- service_role, BYPASSRLS).
DROP POLICY IF EXISTS pay_select_member       ON payments;
DROP POLICY IF EXISTS pay_select_super_admin  ON payments;
DROP POLICY IF EXISTS pay_insert_anon         ON payments;
DROP POLICY IF EXISTS pay_insert_super_admin  ON payments;
DROP POLICY IF EXISTS pay_update_super_admin  ON payments;
DROP POLICY IF EXISTS pay_delete_super_admin  ON payments;
CREATE POLICY pay_select_member ON payments FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY pay_select_super_admin ON payments FOR SELECT USING (is_super_admin());
CREATE POLICY pay_insert_anon ON payments FOR INSERT WITH CHECK (TRUE);
CREATE POLICY pay_insert_super_admin ON payments FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY pay_update_super_admin ON payments FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY pay_delete_super_admin ON payments FOR DELETE USING (is_super_admin());
