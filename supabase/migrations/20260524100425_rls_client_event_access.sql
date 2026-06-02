-- Phase 12 Unit 86: RLS on client_event_access.
-- The cross-tenant access link between client_accounts and
-- events. Tenant members see their own tenant's links;
-- clients see their own access rows; super_admin sees all.
-- Manager-gated INSERT/DELETE; manager OR self-client UPDATE.
--
-- MUST ship BEFORE client_accounts RLS because the
-- ca_select_linked_member predicate joins this table.

DROP POLICY IF EXISTS cea_select_member       ON client_event_access;
DROP POLICY IF EXISTS cea_select_client       ON client_event_access;
DROP POLICY IF EXISTS cea_select_super_admin  ON client_event_access;
DROP POLICY IF EXISTS cea_insert_manager      ON client_event_access;
DROP POLICY IF EXISTS cea_insert_super_admin  ON client_event_access;
DROP POLICY IF EXISTS cea_update_manager      ON client_event_access;
DROP POLICY IF EXISTS cea_update_client       ON client_event_access;
DROP POLICY IF EXISTS cea_update_super_admin  ON client_event_access;
DROP POLICY IF EXISTS cea_delete_manager      ON client_event_access;
DROP POLICY IF EXISTS cea_delete_super_admin  ON client_event_access;

CREATE POLICY cea_select_member ON client_event_access FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY cea_select_client ON client_event_access FOR SELECT USING (
  client_account_id = current_user_id() AND current_user_type() = 'client');
CREATE POLICY cea_select_super_admin ON client_event_access FOR SELECT USING (is_super_admin());

CREATE POLICY cea_insert_manager ON client_event_access FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = client_event_access.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY cea_insert_super_admin ON client_event_access FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY cea_update_manager ON client_event_access FOR UPDATE
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = client_event_access.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = client_event_access.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY cea_update_client ON client_event_access FOR UPDATE
  USING (client_account_id = current_user_id() AND current_user_type() = 'client')
  WITH CHECK (client_account_id = current_user_id() AND current_user_type() = 'client');
CREATE POLICY cea_update_super_admin ON client_event_access FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY cea_delete_manager ON client_event_access FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = client_event_access.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY cea_delete_super_admin ON client_event_access FOR DELETE USING (is_super_admin());
