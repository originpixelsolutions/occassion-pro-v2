-- Phase 12 Unit 74: RLS policies on event_websites.
--
-- First Phase 12 table with a PUBLIC visibility lane.
-- Published wedding/event sites are the public-facing
-- micro-site every guest sees - anyone (anon, guest, etc.)
-- can read when is_published=TRUE. Draft sites
-- (is_published=FALSE) stay tenant-scoped.
--
-- 9 policies: published-public SELECT, member SELECT,
-- super_admin SELECT, owner/event_manager INSERT/DELETE,
-- tenant_member UPDATE (any tenant_member can save drafts),
-- super_admin overrides.
--
-- This anon-can-read lane is the public RLS variant - the
-- fourth canonical RLS shape for Phase 12, reused later
-- for short_links and a handful of other public surfaces.

DROP POLICY IF EXISTS ew_select_published    ON event_websites;
DROP POLICY IF EXISTS ew_select_member       ON event_websites;
DROP POLICY IF EXISTS ew_select_super_admin  ON event_websites;
DROP POLICY IF EXISTS ew_insert_manager      ON event_websites;
DROP POLICY IF EXISTS ew_insert_super_admin  ON event_websites;
DROP POLICY IF EXISTS ew_update_member       ON event_websites;
DROP POLICY IF EXISTS ew_update_super_admin  ON event_websites;
DROP POLICY IF EXISTS ew_delete_manager      ON event_websites;
DROP POLICY IF EXISTS ew_delete_super_admin  ON event_websites;

CREATE POLICY ew_select_published ON event_websites
  FOR SELECT USING (is_published = TRUE);

CREATE POLICY ew_select_member ON event_websites
  FOR SELECT USING (is_tenant_member(tenant_id));

CREATE POLICY ew_select_super_admin ON event_websites
  FOR SELECT USING (is_super_admin());

CREATE POLICY ew_insert_manager ON event_websites
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = event_websites.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));

CREATE POLICY ew_insert_super_admin ON event_websites
  FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY ew_update_member ON event_websites
  FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY ew_update_super_admin ON event_websites
  FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY ew_delete_manager ON event_websites
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.tenant_id = event_websites.tenant_id
        AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));

CREATE POLICY ew_delete_super_admin ON event_websites
  FOR DELETE USING (is_super_admin());
