-- Phase 12 Unit 83: RLS on event_offload_jobs.
-- Job queue model: tenants enqueue jobs (INSERT via
-- owner/event_manager) and read progress (SELECT broad).
-- The worker pipeline runs as service_role (BYPASSRLS), so
-- only super_admin has policy-level UPDATE/DELETE rights to
-- prevent tenants from forging status transitions.

DROP POLICY IF EXISTS eoj_select_member       ON event_offload_jobs;
DROP POLICY IF EXISTS eoj_select_super_admin  ON event_offload_jobs;
DROP POLICY IF EXISTS eoj_insert_manager      ON event_offload_jobs;
DROP POLICY IF EXISTS eoj_insert_super_admin  ON event_offload_jobs;
DROP POLICY IF EXISTS eoj_update_super_admin  ON event_offload_jobs;
DROP POLICY IF EXISTS eoj_delete_super_admin  ON event_offload_jobs;

CREATE POLICY eoj_select_member ON event_offload_jobs FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY eoj_select_super_admin ON event_offload_jobs FOR SELECT USING (is_super_admin());
CREATE POLICY eoj_insert_manager ON event_offload_jobs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = event_offload_jobs.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY eoj_insert_super_admin ON event_offload_jobs FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY eoj_update_super_admin ON event_offload_jobs FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY eoj_delete_super_admin ON event_offload_jobs FOR DELETE USING (is_super_admin());
