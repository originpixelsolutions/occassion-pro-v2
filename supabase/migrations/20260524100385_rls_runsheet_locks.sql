-- Phase 12 Unit 77: RLS policies on runsheet_locks.
--
-- Optimistic-lock table for runsheet edits. Only the
-- lock holder can refresh (UPDATE) their own lock; any
-- tenant_member can read who holds the lock. Holder can
-- release (DELETE) their own lock, OR owner/event_manager
-- can force-release (e.g. when a member's tab crashes).
--
-- INSERT predicate enforces that locked_by must equal
-- current_user_id() - prevents a member from grabbing a
-- lock in someone else's name.

DROP POLICY IF EXISTS rl_select_member       ON runsheet_locks;
DROP POLICY IF EXISTS rl_select_super_admin  ON runsheet_locks;
DROP POLICY IF EXISTS rl_insert_member       ON runsheet_locks;
DROP POLICY IF EXISTS rl_insert_super_admin  ON runsheet_locks;
DROP POLICY IF EXISTS rl_update_holder       ON runsheet_locks;
DROP POLICY IF EXISTS rl_update_super_admin  ON runsheet_locks;
DROP POLICY IF EXISTS rl_delete_holder       ON runsheet_locks;
DROP POLICY IF EXISTS rl_delete_manager      ON runsheet_locks;
DROP POLICY IF EXISTS rl_delete_super_admin  ON runsheet_locks;

CREATE POLICY rl_select_member ON runsheet_locks
  FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY rl_select_super_admin ON runsheet_locks
  FOR SELECT USING (is_super_admin());
CREATE POLICY rl_insert_member ON runsheet_locks
  FOR INSERT WITH CHECK (is_tenant_member(tenant_id) AND locked_by = current_user_id());
CREATE POLICY rl_insert_super_admin ON runsheet_locks
  FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY rl_update_holder ON runsheet_locks
  FOR UPDATE
  USING (is_tenant_member(tenant_id) AND locked_by = current_user_id())
  WITH CHECK (is_tenant_member(tenant_id) AND locked_by = current_user_id());
CREATE POLICY rl_update_super_admin ON runsheet_locks
  FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY rl_delete_holder ON runsheet_locks
  FOR DELETE USING (is_tenant_member(tenant_id) AND locked_by = current_user_id());
CREATE POLICY rl_delete_manager ON runsheet_locks
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = runsheet_locks.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY rl_delete_super_admin ON runsheet_locks
  FOR DELETE USING (is_super_admin());
