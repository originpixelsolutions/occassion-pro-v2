DROP POLICY IF EXISTS np_select_self          ON notification_preferences;
DROP POLICY IF EXISTS np_select_super_admin   ON notification_preferences;
DROP POLICY IF EXISTS np_insert_self          ON notification_preferences;
DROP POLICY IF EXISTS np_insert_super_admin   ON notification_preferences;
DROP POLICY IF EXISTS np_update_self          ON notification_preferences;
DROP POLICY IF EXISTS np_update_super_admin   ON notification_preferences;
DROP POLICY IF EXISTS np_delete_self          ON notification_preferences;
DROP POLICY IF EXISTS np_delete_super_admin   ON notification_preferences;
CREATE POLICY np_select_self ON notification_preferences FOR SELECT USING (user_id = current_user_id() AND user_type = current_user_type());
CREATE POLICY np_select_super_admin ON notification_preferences FOR SELECT USING (is_super_admin());
CREATE POLICY np_insert_self ON notification_preferences FOR INSERT WITH CHECK (user_id = current_user_id() AND user_type = current_user_type());
CREATE POLICY np_insert_super_admin ON notification_preferences FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY np_update_self ON notification_preferences FOR UPDATE
  USING (user_id = current_user_id() AND user_type = current_user_type())
  WITH CHECK (user_id = current_user_id() AND user_type = current_user_type());
CREATE POLICY np_update_super_admin ON notification_preferences FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY np_delete_self ON notification_preferences FOR DELETE USING (user_id = current_user_id() AND user_type = current_user_type());
CREATE POLICY np_delete_super_admin ON notification_preferences FOR DELETE USING (is_super_admin());
