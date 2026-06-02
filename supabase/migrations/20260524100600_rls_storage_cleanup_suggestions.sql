-- Phase 12 Unit 105c: RLS on storage_cleanup_suggestions.
-- Analyser-generated; tenants SELECT/UPDATE to ack/dismiss.
DROP POLICY IF EXISTS scs_select_member       ON storage_cleanup_suggestions;
DROP POLICY IF EXISTS scs_select_super_admin  ON storage_cleanup_suggestions;
DROP POLICY IF EXISTS scs_insert_super_admin  ON storage_cleanup_suggestions;
DROP POLICY IF EXISTS scs_update_member       ON storage_cleanup_suggestions;
DROP POLICY IF EXISTS scs_update_super_admin  ON storage_cleanup_suggestions;
DROP POLICY IF EXISTS scs_delete_super_admin  ON storage_cleanup_suggestions;
CREATE POLICY scs_select_member ON storage_cleanup_suggestions FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY scs_select_super_admin ON storage_cleanup_suggestions FOR SELECT USING (is_super_admin());
CREATE POLICY scs_insert_super_admin ON storage_cleanup_suggestions FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY scs_update_member ON storage_cleanup_suggestions FOR UPDATE USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY scs_update_super_admin ON storage_cleanup_suggestions FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY scs_delete_super_admin ON storage_cleanup_suggestions FOR DELETE USING (is_super_admin());
