-- Phase 12 Unit 97: RLS on invitations.
-- Direct tenant_id + public-published lane (template 4
-- reuse). Published invitations are the public-facing
-- artifact a guest receives via short_link; drafts stay
-- tenant-scoped.
DROP POLICY IF EXISTS inv_select_published    ON invitations;
DROP POLICY IF EXISTS inv_select_member       ON invitations;
DROP POLICY IF EXISTS inv_select_super_admin  ON invitations;
DROP POLICY IF EXISTS inv_insert_manager      ON invitations;
DROP POLICY IF EXISTS inv_insert_super_admin  ON invitations;
DROP POLICY IF EXISTS inv_update_member       ON invitations;
DROP POLICY IF EXISTS inv_update_super_admin  ON invitations;
DROP POLICY IF EXISTS inv_delete_manager      ON invitations;
DROP POLICY IF EXISTS inv_delete_super_admin  ON invitations;

CREATE POLICY inv_select_published ON invitations FOR SELECT USING (is_published = TRUE);
CREATE POLICY inv_select_member ON invitations FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY inv_select_super_admin ON invitations FOR SELECT USING (is_super_admin());

CREATE POLICY inv_insert_manager ON invitations FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = invitations.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY inv_insert_super_admin ON invitations FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY inv_update_member ON invitations FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY inv_update_super_admin ON invitations FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY inv_delete_manager ON invitations FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = invitations.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY inv_delete_super_admin ON invitations FOR DELETE USING (is_super_admin());
