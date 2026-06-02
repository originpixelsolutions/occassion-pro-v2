-- Phase 12 Unit 99c: RLS on inventory_audits. Append-only
-- (template 6). tenant_member SELECT/INSERT; no UPDATE;
-- super_admin DELETE for retention only.
DROP POLICY IF EXISTS iau_select_member       ON inventory_audits;
DROP POLICY IF EXISTS iau_select_super_admin  ON inventory_audits;
DROP POLICY IF EXISTS iau_insert_member       ON inventory_audits;
DROP POLICY IF EXISTS iau_insert_super_admin  ON inventory_audits;
DROP POLICY IF EXISTS iau_delete_super_admin  ON inventory_audits;
CREATE POLICY iau_select_member ON inventory_audits FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY iau_select_super_admin ON inventory_audits FOR SELECT USING (is_super_admin());
CREATE POLICY iau_insert_member ON inventory_audits FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY iau_insert_super_admin ON inventory_audits FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY iau_delete_super_admin ON inventory_audits FOR DELETE USING (is_super_admin());
