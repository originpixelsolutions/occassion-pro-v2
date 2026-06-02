-- Phase 12 Unit 98a: RLS on short_links. Public-resolve
-- lane: any caller can SELECT active+non-deleted links so
-- the resolver service can look up by code without auth.
DROP POLICY IF EXISTS sl_select_active        ON short_links;
DROP POLICY IF EXISTS sl_select_member        ON short_links;
DROP POLICY IF EXISTS sl_select_super_admin   ON short_links;
DROP POLICY IF EXISTS sl_insert_member        ON short_links;
DROP POLICY IF EXISTS sl_insert_super_admin   ON short_links;
DROP POLICY IF EXISTS sl_update_member        ON short_links;
DROP POLICY IF EXISTS sl_update_super_admin   ON short_links;
DROP POLICY IF EXISTS sl_delete_manager       ON short_links;
DROP POLICY IF EXISTS sl_delete_super_admin   ON short_links;

CREATE POLICY sl_select_active ON short_links FOR SELECT USING (
  is_active = TRUE AND deleted_at IS NULL);
CREATE POLICY sl_select_member ON short_links FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY sl_select_super_admin ON short_links FOR SELECT USING (is_super_admin());

CREATE POLICY sl_insert_member ON short_links FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY sl_insert_super_admin ON short_links FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY sl_update_member ON short_links FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY sl_update_super_admin ON short_links FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY sl_delete_manager ON short_links FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = short_links.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY sl_delete_super_admin ON short_links FOR DELETE USING (is_super_admin());
