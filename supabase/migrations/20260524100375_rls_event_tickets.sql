-- Phase 12 Unit 75: RLS policies on event_tickets.
-- Canonical tenant_id-direct shape (events template).
DROP POLICY IF EXISTS et_select_member       ON event_tickets;
DROP POLICY IF EXISTS et_select_super_admin  ON event_tickets;
DROP POLICY IF EXISTS et_insert_manager      ON event_tickets;
DROP POLICY IF EXISTS et_insert_super_admin  ON event_tickets;
DROP POLICY IF EXISTS et_update_member       ON event_tickets;
DROP POLICY IF EXISTS et_update_super_admin  ON event_tickets;
DROP POLICY IF EXISTS et_delete_manager      ON event_tickets;
DROP POLICY IF EXISTS et_delete_super_admin  ON event_tickets;

CREATE POLICY et_select_member ON event_tickets
  FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY et_select_super_admin ON event_tickets
  FOR SELECT USING (is_super_admin());
CREATE POLICY et_insert_manager ON event_tickets
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = event_tickets.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY et_insert_super_admin ON event_tickets
  FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY et_update_member ON event_tickets
  FOR UPDATE USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY et_update_super_admin ON event_tickets
  FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY et_delete_manager ON event_tickets
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = event_tickets.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY et_delete_super_admin ON event_tickets
  FOR DELETE USING (is_super_admin());
