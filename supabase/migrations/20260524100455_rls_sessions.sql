-- Phase 12 Unit 91: RLS on sessions.
-- Direct tenant_id + public-published lane. Published
-- sessions are visible publicly because they appear on the
-- public event website agenda. Drafts stay tenant-scoped.
DROP POLICY IF EXISTS ss_select_published    ON sessions;
DROP POLICY IF EXISTS ss_select_member       ON sessions;
DROP POLICY IF EXISTS ss_select_super_admin  ON sessions;
DROP POLICY IF EXISTS ss_insert_manager      ON sessions;
DROP POLICY IF EXISTS ss_insert_super_admin  ON sessions;
DROP POLICY IF EXISTS ss_update_member       ON sessions;
DROP POLICY IF EXISTS ss_update_super_admin  ON sessions;
DROP POLICY IF EXISTS ss_delete_manager      ON sessions;
DROP POLICY IF EXISTS ss_delete_super_admin  ON sessions;

CREATE POLICY ss_select_published ON sessions
  FOR SELECT USING (is_published = TRUE);
CREATE POLICY ss_select_member ON sessions
  FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY ss_select_super_admin ON sessions
  FOR SELECT USING (is_super_admin());

CREATE POLICY ss_insert_manager ON sessions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = sessions.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY ss_insert_super_admin ON sessions FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY ss_update_member ON sessions FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY ss_update_super_admin ON sessions FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY ss_delete_manager ON sessions FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = sessions.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY ss_delete_super_admin ON sessions FOR DELETE USING (is_super_admin());
