-- Phase 12 Unit 78: RLS policies on runsheet_versions.
--
-- Append-only snapshot/diff history. Any tenant_member can
-- SELECT and INSERT (snapshots are saved automatically + on
-- demand). INSERT enforces created_by must be the caller
-- if set, preventing attribution spoofing. No UPDATE policy
-- - versions are immutable by design. DELETE
-- owner/event_manager only (retention cleanup).

DROP POLICY IF EXISTS rv_select_member       ON runsheet_versions;
DROP POLICY IF EXISTS rv_select_super_admin  ON runsheet_versions;
DROP POLICY IF EXISTS rv_insert_member       ON runsheet_versions;
DROP POLICY IF EXISTS rv_insert_super_admin  ON runsheet_versions;
DROP POLICY IF EXISTS rv_delete_manager      ON runsheet_versions;
DROP POLICY IF EXISTS rv_delete_super_admin  ON runsheet_versions;

CREATE POLICY rv_select_member ON runsheet_versions
  FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY rv_select_super_admin ON runsheet_versions
  FOR SELECT USING (is_super_admin());
CREATE POLICY rv_insert_member ON runsheet_versions
  FOR INSERT WITH CHECK (
    is_tenant_member(tenant_id)
    AND (created_by IS NULL OR created_by = current_user_id())
  );
CREATE POLICY rv_insert_super_admin ON runsheet_versions
  FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY rv_delete_manager ON runsheet_versions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = runsheet_versions.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY rv_delete_super_admin ON runsheet_versions
  FOR DELETE USING (is_super_admin());
