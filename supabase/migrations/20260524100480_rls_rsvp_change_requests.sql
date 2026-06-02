-- Phase 12 Unit 96: RLS on rsvp_change_requests.
-- Guest-initiated request log for late RSVP changes after
-- the cutoff date. tenant_member SELECT/UPDATE (approve/
-- reject); guest SELECT/INSERT own; no DELETE except
-- super_admin.
DROP POLICY IF EXISTS rcr_select_member       ON rsvp_change_requests;
DROP POLICY IF EXISTS rcr_select_guest        ON rsvp_change_requests;
DROP POLICY IF EXISTS rcr_select_super_admin  ON rsvp_change_requests;
DROP POLICY IF EXISTS rcr_insert_guest        ON rsvp_change_requests;
DROP POLICY IF EXISTS rcr_insert_member       ON rsvp_change_requests;
DROP POLICY IF EXISTS rcr_insert_super_admin  ON rsvp_change_requests;
DROP POLICY IF EXISTS rcr_update_member       ON rsvp_change_requests;
DROP POLICY IF EXISTS rcr_update_super_admin  ON rsvp_change_requests;
DROP POLICY IF EXISTS rcr_delete_super_admin  ON rsvp_change_requests;

CREATE POLICY rcr_select_member ON rsvp_change_requests FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY rcr_select_guest ON rsvp_change_requests FOR SELECT USING (
  guest_id = current_user_id() AND current_user_type() = 'guest');
CREATE POLICY rcr_select_super_admin ON rsvp_change_requests FOR SELECT USING (is_super_admin());

CREATE POLICY rcr_insert_guest ON rsvp_change_requests FOR INSERT WITH CHECK (
  guest_id = current_user_id() AND current_user_type() = 'guest');
CREATE POLICY rcr_insert_member ON rsvp_change_requests FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY rcr_insert_super_admin ON rsvp_change_requests FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY rcr_update_member ON rsvp_change_requests FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY rcr_update_super_admin ON rsvp_change_requests FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY rcr_delete_super_admin ON rsvp_change_requests FOR DELETE USING (is_super_admin());
