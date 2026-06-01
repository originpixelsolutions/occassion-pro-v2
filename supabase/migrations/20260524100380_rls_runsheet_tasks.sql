-- Phase 12 Unit 76: RLS policies on runsheet_tasks.
-- runsheet_tasks is the day-of-event execution surface.
-- ANY tenant_member can INSERT/UPDATE because the planning
-- + execution UX needs lots of small edits from team_members
-- in real time. DELETE is owner/event_manager only to
-- prevent accidental cleanup during a live event.
DROP POLICY IF EXISTS rt_select_member       ON runsheet_tasks;
DROP POLICY IF EXISTS rt_select_super_admin  ON runsheet_tasks;
DROP POLICY IF EXISTS rt_insert_member       ON runsheet_tasks;
DROP POLICY IF EXISTS rt_insert_super_admin  ON runsheet_tasks;
DROP POLICY IF EXISTS rt_update_member       ON runsheet_tasks;
DROP POLICY IF EXISTS rt_update_super_admin  ON runsheet_tasks;
DROP POLICY IF EXISTS rt_delete_manager      ON runsheet_tasks;
DROP POLICY IF EXISTS rt_delete_super_admin  ON runsheet_tasks;

CREATE POLICY rt_select_member ON runsheet_tasks
  FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY rt_select_super_admin ON runsheet_tasks
  FOR SELECT USING (is_super_admin());
CREATE POLICY rt_insert_member ON runsheet_tasks
  FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY rt_insert_super_admin ON runsheet_tasks
  FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY rt_update_member ON runsheet_tasks
  FOR UPDATE USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY rt_update_super_admin ON runsheet_tasks
  FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY rt_delete_manager ON runsheet_tasks
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = runsheet_tasks.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY rt_delete_super_admin ON runsheet_tasks
  FOR DELETE USING (is_super_admin());
