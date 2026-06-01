-- Phase 12 Unit 73: RLS policies on event_readiness_state.
--
-- Junction-style (no tenant_id column) - tenant scope joins
-- through events. Any non-revoked tenant_member can flip
-- readiness items because this is a routine operational
-- action (checkbox in the readiness panel).
--
-- INSERT: tenant_member (broadcast UI seeds the row when
-- the item is first toggled).
-- UPDATE: tenant_member (toggle is_complete).
-- DELETE: owner/event_manager (cleanup is structural).

DROP POLICY IF EXISTS ers_select_member       ON event_readiness_state;
DROP POLICY IF EXISTS ers_select_super_admin  ON event_readiness_state;
DROP POLICY IF EXISTS ers_insert_member       ON event_readiness_state;
DROP POLICY IF EXISTS ers_insert_super_admin  ON event_readiness_state;
DROP POLICY IF EXISTS ers_update_member       ON event_readiness_state;
DROP POLICY IF EXISTS ers_update_super_admin  ON event_readiness_state;
DROP POLICY IF EXISTS ers_delete_manager      ON event_readiness_state;
DROP POLICY IF EXISTS ers_delete_super_admin  ON event_readiness_state;

CREATE POLICY ers_select_member ON event_readiness_state
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM events e
      WHERE e.id = event_readiness_state.event_id
        AND is_tenant_member(e.tenant_id))
  );

CREATE POLICY ers_select_super_admin ON event_readiness_state
  FOR SELECT USING (is_super_admin());

CREATE POLICY ers_insert_member ON event_readiness_state
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM events e
      WHERE e.id = event_readiness_state.event_id
        AND is_tenant_member(e.tenant_id))
  );

CREATE POLICY ers_insert_super_admin ON event_readiness_state
  FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY ers_update_member ON event_readiness_state
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM events e
      WHERE e.id = event_readiness_state.event_id
        AND is_tenant_member(e.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM events e
      WHERE e.id = event_readiness_state.event_id
        AND is_tenant_member(e.tenant_id)));

CREATE POLICY ers_update_super_admin ON event_readiness_state
  FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY ers_delete_manager ON event_readiness_state
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM events e JOIN tenant_members tm ON tm.tenant_id = e.tenant_id
      WHERE e.id = event_readiness_state.event_id
        AND tm.id = current_user_id()
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL)
  );

CREATE POLICY ers_delete_super_admin ON event_readiness_state
  FOR DELETE USING (is_super_admin());
