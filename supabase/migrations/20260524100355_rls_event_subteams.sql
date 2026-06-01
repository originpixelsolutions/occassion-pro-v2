-- Phase 12 Unit 71: RLS policies on event_subteams.
-- Standard operational shape: tenant_member SELECT/UPDATE,
-- owner/event_manager INSERT/DELETE, super_admin override.
DROP POLICY IF EXISTS est_select_member       ON event_subteams;
DROP POLICY IF EXISTS est_select_super_admin  ON event_subteams;
DROP POLICY IF EXISTS est_insert_manager      ON event_subteams;
DROP POLICY IF EXISTS est_insert_super_admin  ON event_subteams;
DROP POLICY IF EXISTS est_update_member       ON event_subteams;
DROP POLICY IF EXISTS est_update_super_admin  ON event_subteams;
DROP POLICY IF EXISTS est_delete_manager      ON event_subteams;
DROP POLICY IF EXISTS est_delete_super_admin  ON event_subteams;

CREATE POLICY est_select_member ON event_subteams
  FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY est_select_super_admin ON event_subteams
  FOR SELECT USING (is_super_admin());
CREATE POLICY est_insert_manager ON event_subteams
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = event_subteams.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY est_insert_super_admin ON event_subteams
  FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY est_update_member ON event_subteams
  FOR UPDATE USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY est_update_super_admin ON event_subteams
  FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY est_delete_manager ON event_subteams
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = event_subteams.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY est_delete_super_admin ON event_subteams
  FOR DELETE USING (is_super_admin());
