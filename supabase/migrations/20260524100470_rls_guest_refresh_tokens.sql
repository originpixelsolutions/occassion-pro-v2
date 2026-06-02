-- Phase 12 Unit 94: RLS on guest_refresh_tokens.
-- Secret-material lockdown (template 9). API server runs
-- as service_role (BYPASSRLS); only super_admin has policy
-- visibility for forensics.
DROP POLICY IF EXISTS grt_select_super_admin   ON guest_refresh_tokens;
DROP POLICY IF EXISTS grt_insert_super_admin   ON guest_refresh_tokens;
DROP POLICY IF EXISTS grt_update_super_admin   ON guest_refresh_tokens;
DROP POLICY IF EXISTS grt_delete_super_admin   ON guest_refresh_tokens;

CREATE POLICY grt_select_super_admin ON guest_refresh_tokens FOR SELECT USING (is_super_admin());
CREATE POLICY grt_insert_super_admin ON guest_refresh_tokens FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY grt_update_super_admin ON guest_refresh_tokens FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY grt_delete_super_admin ON guest_refresh_tokens FOR DELETE USING (is_super_admin());
