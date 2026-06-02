-- Phase 12 Unit 92: RLS on guests.
-- Direct tenant_id table with guest self-update lane.
-- Broad tenant_member INSERT (guest list imports run from
-- any tenant_member). Guest self can SELECT and UPDATE own
-- row to flip RSVP status / dietary / etc.
DROP POLICY IF EXISTS gst_select_member       ON guests;
DROP POLICY IF EXISTS gst_select_self_guest   ON guests;
DROP POLICY IF EXISTS gst_select_super_admin  ON guests;
DROP POLICY IF EXISTS gst_insert_member       ON guests;
DROP POLICY IF EXISTS gst_insert_super_admin  ON guests;
DROP POLICY IF EXISTS gst_update_member       ON guests;
DROP POLICY IF EXISTS gst_update_self_guest   ON guests;
DROP POLICY IF EXISTS gst_update_super_admin  ON guests;
DROP POLICY IF EXISTS gst_delete_manager      ON guests;
DROP POLICY IF EXISTS gst_delete_super_admin  ON guests;

CREATE POLICY gst_select_member ON guests FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY gst_select_self_guest ON guests FOR SELECT USING (
  id = current_user_id() AND current_user_type() = 'guest');
CREATE POLICY gst_select_super_admin ON guests FOR SELECT USING (is_super_admin());

CREATE POLICY gst_insert_member ON guests FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY gst_insert_super_admin ON guests FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY gst_update_member ON guests FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY gst_update_self_guest ON guests FOR UPDATE
  USING (id = current_user_id() AND current_user_type() = 'guest')
  WITH CHECK (id = current_user_id() AND current_user_type() = 'guest');
CREATE POLICY gst_update_super_admin ON guests FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY gst_delete_manager ON guests FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = guests.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY gst_delete_super_admin ON guests FOR DELETE USING (is_super_admin());
