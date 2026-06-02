-- Phase 12 Unit 98b: RLS on short_link_clicks. Click
-- telemetry. tenant_member SELECT; anon INSERT (the
-- resolver service records the click without auth); no
-- UPDATE; super_admin DELETE for retention.
DROP POLICY IF EXISTS slc_select_member       ON short_link_clicks;
DROP POLICY IF EXISTS slc_select_super_admin  ON short_link_clicks;
DROP POLICY IF EXISTS slc_insert_anon         ON short_link_clicks;
DROP POLICY IF EXISTS slc_insert_super_admin  ON short_link_clicks;
DROP POLICY IF EXISTS slc_delete_super_admin  ON short_link_clicks;

CREATE POLICY slc_select_member ON short_link_clicks FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY slc_select_super_admin ON short_link_clicks FOR SELECT USING (is_super_admin());
CREATE POLICY slc_insert_anon ON short_link_clicks FOR INSERT WITH CHECK (TRUE);
CREATE POLICY slc_insert_super_admin ON short_link_clicks FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY slc_delete_super_admin ON short_link_clicks FOR DELETE USING (is_super_admin());
