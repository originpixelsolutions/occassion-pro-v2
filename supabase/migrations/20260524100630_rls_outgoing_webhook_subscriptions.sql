DROP POLICY IF EXISTS ows_select_member       ON outgoing_webhook_subscriptions;
DROP POLICY IF EXISTS ows_select_super_admin  ON outgoing_webhook_subscriptions;
DROP POLICY IF EXISTS ows_insert_manager      ON outgoing_webhook_subscriptions;
DROP POLICY IF EXISTS ows_insert_super_admin  ON outgoing_webhook_subscriptions;
DROP POLICY IF EXISTS ows_update_member       ON outgoing_webhook_subscriptions;
DROP POLICY IF EXISTS ows_update_super_admin  ON outgoing_webhook_subscriptions;
DROP POLICY IF EXISTS ows_delete_manager      ON outgoing_webhook_subscriptions;
DROP POLICY IF EXISTS ows_delete_super_admin  ON outgoing_webhook_subscriptions;
CREATE POLICY ows_select_member ON outgoing_webhook_subscriptions FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY ows_select_super_admin ON outgoing_webhook_subscriptions FOR SELECT USING (is_super_admin());
CREATE POLICY ows_insert_manager ON outgoing_webhook_subscriptions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = outgoing_webhook_subscriptions.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY ows_insert_super_admin ON outgoing_webhook_subscriptions FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY ows_update_member ON outgoing_webhook_subscriptions FOR UPDATE USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY ows_update_super_admin ON outgoing_webhook_subscriptions FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY ows_delete_manager ON outgoing_webhook_subscriptions FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = outgoing_webhook_subscriptions.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY ows_delete_super_admin ON outgoing_webhook_subscriptions FOR DELETE USING (is_super_admin());
