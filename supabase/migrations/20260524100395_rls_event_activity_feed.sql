-- Phase 12 Unit 79: RLS policies on event_activity_feed.
--
-- Per-event append-only activity stream (separate from
-- platform-wide audit_log). Members SELECT/INSERT, no
-- UPDATE (immutable), manager DELETE for cleanup.
--
-- INSERT enforces actor_type membership in the allowed
-- enum subset, and when actor_type='tenant_member' the
-- actor_id must equal the caller - prevents attribution
-- spoofing while still allowing service jobs to write
-- system-typed entries with actor_id NULL.

DROP POLICY IF EXISTS eaf_select_member       ON event_activity_feed;
DROP POLICY IF EXISTS eaf_select_super_admin  ON event_activity_feed;
DROP POLICY IF EXISTS eaf_insert_member       ON event_activity_feed;
DROP POLICY IF EXISTS eaf_insert_super_admin  ON event_activity_feed;
DROP POLICY IF EXISTS eaf_delete_manager      ON event_activity_feed;
DROP POLICY IF EXISTS eaf_delete_super_admin  ON event_activity_feed;

CREATE POLICY eaf_select_member ON event_activity_feed
  FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY eaf_select_super_admin ON event_activity_feed
  FOR SELECT USING (is_super_admin());
CREATE POLICY eaf_insert_member ON event_activity_feed
  FOR INSERT WITH CHECK (
    is_tenant_member(tenant_id)
    AND actor_type IN ('tenant_member','system','client','vendor','guest','speaker')
    AND (actor_type <> 'tenant_member' OR actor_id = current_user_id())
  );
CREATE POLICY eaf_insert_super_admin ON event_activity_feed
  FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY eaf_delete_manager ON event_activity_feed
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = event_activity_feed.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY eaf_delete_super_admin ON event_activity_feed
  FOR DELETE USING (is_super_admin());
