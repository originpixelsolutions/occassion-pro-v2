-- Phase 12 Unit 105b: RLS on storage_archive_events.
-- Worker-owned (service_role writes); tenants read own.
DROP POLICY IF EXISTS sae_select_member       ON storage_archive_events;
DROP POLICY IF EXISTS sae_select_super_admin  ON storage_archive_events;
DROP POLICY IF EXISTS sae_insert_super_admin  ON storage_archive_events;
DROP POLICY IF EXISTS sae_update_super_admin  ON storage_archive_events;
DROP POLICY IF EXISTS sae_delete_super_admin  ON storage_archive_events;
CREATE POLICY sae_select_member ON storage_archive_events FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY sae_select_super_admin ON storage_archive_events FOR SELECT USING (is_super_admin());
CREATE POLICY sae_insert_super_admin ON storage_archive_events FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY sae_update_super_admin ON storage_archive_events FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY sae_delete_super_admin ON storage_archive_events FOR DELETE USING (is_super_admin());
