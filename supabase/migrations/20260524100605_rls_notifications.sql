DROP POLICY IF EXISTS ntf_select_member       ON notifications;
DROP POLICY IF EXISTS ntf_select_recipient    ON notifications;
DROP POLICY IF EXISTS ntf_select_super_admin  ON notifications;
DROP POLICY IF EXISTS ntf_insert_super_admin  ON notifications;
DROP POLICY IF EXISTS ntf_update_recipient    ON notifications;
DROP POLICY IF EXISTS ntf_update_super_admin  ON notifications;
DROP POLICY IF EXISTS ntf_delete_super_admin  ON notifications;
CREATE POLICY ntf_select_member ON notifications FOR SELECT USING (tenant_id IS NOT NULL AND is_tenant_member(tenant_id));
CREATE POLICY ntf_select_recipient ON notifications FOR SELECT USING (recipient_id = current_user_id() AND recipient_type = current_user_type());
CREATE POLICY ntf_select_super_admin ON notifications FOR SELECT USING (is_super_admin());
CREATE POLICY ntf_insert_super_admin ON notifications FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY ntf_update_recipient ON notifications FOR UPDATE
  USING (recipient_id = current_user_id() AND recipient_type = current_user_type())
  WITH CHECK (recipient_id = current_user_id() AND recipient_type = current_user_type());
CREATE POLICY ntf_update_super_admin ON notifications FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY ntf_delete_super_admin ON notifications FOR DELETE USING (is_super_admin());
