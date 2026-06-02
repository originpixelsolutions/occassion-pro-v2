DROP POLICY IF EXISTS nd_select_member       ON notification_deliveries;
DROP POLICY IF EXISTS nd_select_super_admin  ON notification_deliveries;
DROP POLICY IF EXISTS nd_insert_super_admin  ON notification_deliveries;
DROP POLICY IF EXISTS nd_update_super_admin  ON notification_deliveries;
DROP POLICY IF EXISTS nd_delete_super_admin  ON notification_deliveries;
CREATE POLICY nd_select_member ON notification_deliveries FOR SELECT USING (
  EXISTS (SELECT 1 FROM notifications n WHERE n.id = notification_deliveries.notification_id
    AND n.tenant_id IS NOT NULL AND is_tenant_member(n.tenant_id)));
CREATE POLICY nd_select_super_admin ON notification_deliveries FOR SELECT USING (is_super_admin());
CREATE POLICY nd_insert_super_admin ON notification_deliveries FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY nd_update_super_admin ON notification_deliveries FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY nd_delete_super_admin ON notification_deliveries FOR DELETE USING (is_super_admin());
