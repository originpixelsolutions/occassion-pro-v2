-- Phase 12 Unit 82: RLS on event_edit_sessions.
-- Identity-bound + join-through-parent (events) for tenant
-- scope. user_id = current_user_id() prevents spoofing.
-- Self can UPDATE/DELETE; owner/event_manager can force-release.

DROP POLICY IF EXISTS ees_select_member       ON event_edit_sessions;
DROP POLICY IF EXISTS ees_select_super_admin  ON event_edit_sessions;
DROP POLICY IF EXISTS ees_insert_self         ON event_edit_sessions;
DROP POLICY IF EXISTS ees_insert_super_admin  ON event_edit_sessions;
DROP POLICY IF EXISTS ees_update_self         ON event_edit_sessions;
DROP POLICY IF EXISTS ees_update_super_admin  ON event_edit_sessions;
DROP POLICY IF EXISTS ees_delete_self         ON event_edit_sessions;
DROP POLICY IF EXISTS ees_delete_manager      ON event_edit_sessions;
DROP POLICY IF EXISTS ees_delete_super_admin  ON event_edit_sessions;

CREATE POLICY ees_select_member ON event_edit_sessions FOR SELECT USING (
  EXISTS (SELECT 1 FROM events e WHERE e.id = event_edit_sessions.event_id AND is_tenant_member(e.tenant_id)));
CREATE POLICY ees_select_super_admin ON event_edit_sessions FOR SELECT USING (is_super_admin());

CREATE POLICY ees_insert_self ON event_edit_sessions FOR INSERT WITH CHECK (
  user_id = current_user_id() AND
  EXISTS (SELECT 1 FROM events e WHERE e.id = event_edit_sessions.event_id AND is_tenant_member(e.tenant_id)));
CREATE POLICY ees_insert_super_admin ON event_edit_sessions FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY ees_update_self ON event_edit_sessions FOR UPDATE
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());
CREATE POLICY ees_update_super_admin ON event_edit_sessions FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY ees_delete_self ON event_edit_sessions FOR DELETE USING (user_id = current_user_id());
CREATE POLICY ees_delete_manager ON event_edit_sessions FOR DELETE USING (
  EXISTS (SELECT 1 FROM events e JOIN tenant_members tm ON tm.tenant_id = e.tenant_id
    WHERE e.id = event_edit_sessions.event_id
      AND tm.id = current_user_id()
      AND tm.role IN ('owner','event_manager')
      AND tm.removed_at IS NULL));
CREATE POLICY ees_delete_super_admin ON event_edit_sessions FOR DELETE USING (is_super_admin());
