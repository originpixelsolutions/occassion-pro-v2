-- Phase 12 Unit 72: RLS policies on event_subteam_members.
--
-- Junction table with no tenant_id column. Tenant scope is
-- derived by joining through event_subteams. This is the
-- "join-through-parent" RLS variant - the second canonical
-- shape that recurs across pure junction tables in Phase 12.
--
-- SELECT: any tenant_member of the parent subteam's tenant.
-- INSERT/DELETE: owner/event_manager of that tenant only.
-- super_admin override.
--
-- No UPDATE policy - the row is a (subteam_id, member_id)
-- pair with only added_at metadata; corrections happen by
-- DELETE+INSERT, not in-place update.

DROP POLICY IF EXISTS estm_select_member       ON event_subteam_members;
DROP POLICY IF EXISTS estm_select_super_admin  ON event_subteam_members;
DROP POLICY IF EXISTS estm_insert_manager      ON event_subteam_members;
DROP POLICY IF EXISTS estm_insert_super_admin  ON event_subteam_members;
DROP POLICY IF EXISTS estm_delete_manager      ON event_subteam_members;
DROP POLICY IF EXISTS estm_delete_super_admin  ON event_subteam_members;

CREATE POLICY estm_select_member ON event_subteam_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM event_subteams es
      WHERE es.id = event_subteam_members.subteam_id
        AND is_tenant_member(es.tenant_id))
  );

CREATE POLICY estm_select_super_admin ON event_subteam_members
  FOR SELECT USING (is_super_admin());

CREATE POLICY estm_insert_manager ON event_subteam_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM event_subteams es JOIN tenant_members tm
              ON tm.tenant_id = es.tenant_id
      WHERE es.id = event_subteam_members.subteam_id
        AND tm.id = current_user_id()
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL)
  );

CREATE POLICY estm_insert_super_admin ON event_subteam_members
  FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY estm_delete_manager ON event_subteam_members
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM event_subteams es JOIN tenant_members tm
              ON tm.tenant_id = es.tenant_id
      WHERE es.id = event_subteam_members.subteam_id
        AND tm.id = current_user_id()
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL)
  );

CREATE POLICY estm_delete_super_admin ON event_subteam_members
  FOR DELETE USING (is_super_admin());
