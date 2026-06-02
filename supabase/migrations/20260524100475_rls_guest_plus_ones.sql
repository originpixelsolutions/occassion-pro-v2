-- Phase 12 Unit 95: RLS on guest_plus_ones.
-- Direct tenant_id + parent-guest self-access. The primary
-- guest can add/edit/remove their own +1s (typical wedding
-- RSVP flow). Tenant_members manage from the back office.
DROP POLICY IF EXISTS gpo_select_member       ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_select_parent_guest ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_select_super_admin  ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_insert_member       ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_insert_parent_guest ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_insert_super_admin  ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_update_member       ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_update_parent_guest ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_update_super_admin  ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_delete_member       ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_delete_parent_guest ON guest_plus_ones;
DROP POLICY IF EXISTS gpo_delete_super_admin  ON guest_plus_ones;

CREATE POLICY gpo_select_member ON guest_plus_ones FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY gpo_select_parent_guest ON guest_plus_ones FOR SELECT USING (
  primary_guest_id = current_user_id() AND current_user_type() = 'guest');
CREATE POLICY gpo_select_super_admin ON guest_plus_ones FOR SELECT USING (is_super_admin());

CREATE POLICY gpo_insert_member ON guest_plus_ones FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY gpo_insert_parent_guest ON guest_plus_ones FOR INSERT WITH CHECK (
  primary_guest_id = current_user_id() AND current_user_type() = 'guest');
CREATE POLICY gpo_insert_super_admin ON guest_plus_ones FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY gpo_update_member ON guest_plus_ones FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY gpo_update_parent_guest ON guest_plus_ones FOR UPDATE
  USING (primary_guest_id = current_user_id() AND current_user_type() = 'guest')
  WITH CHECK (primary_guest_id = current_user_id() AND current_user_type() = 'guest');
CREATE POLICY gpo_update_super_admin ON guest_plus_ones FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY gpo_delete_member ON guest_plus_ones FOR DELETE USING (is_tenant_member(tenant_id));
CREATE POLICY gpo_delete_parent_guest ON guest_plus_ones FOR DELETE USING (
  primary_guest_id = current_user_id() AND current_user_type() = 'guest');
CREATE POLICY gpo_delete_super_admin ON guest_plus_ones FOR DELETE USING (is_super_admin());
