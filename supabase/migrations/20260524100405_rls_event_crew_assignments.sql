-- Phase 12 Unit 81: RLS policies on event_crew_assignments.
-- Canonical tenant_id-direct shape (events template).
DROP POLICY IF EXISTS eca_select_member       ON event_crew_assignments;
DROP POLICY IF EXISTS eca_select_super_admin  ON event_crew_assignments;
DROP POLICY IF EXISTS eca_insert_manager      ON event_crew_assignments;
DROP POLICY IF EXISTS eca_insert_super_admin  ON event_crew_assignments;
DROP POLICY IF EXISTS eca_update_member       ON event_crew_assignments;
DROP POLICY IF EXISTS eca_update_super_admin  ON event_crew_assignments;
DROP POLICY IF EXISTS eca_delete_manager      ON event_crew_assignments;
DROP POLICY IF EXISTS eca_delete_super_admin  ON event_crew_assignments;

CREATE POLICY eca_select_member ON event_crew_assignments FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY eca_select_super_admin ON event_crew_assignments FOR SELECT USING (is_super_admin());
CREATE POLICY eca_insert_manager ON event_crew_assignments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = event_crew_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY eca_insert_super_admin ON event_crew_assignments FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY eca_update_member ON event_crew_assignments FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY eca_update_super_admin ON event_crew_assignments FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY eca_delete_manager ON event_crew_assignments FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = event_crew_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY eca_delete_super_admin ON event_crew_assignments FOR DELETE USING (is_super_admin());
