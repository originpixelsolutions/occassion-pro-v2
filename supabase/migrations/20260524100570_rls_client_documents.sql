-- Phase 12 Unit 103: RLS on client_documents.
-- Direct tenant_id + client self-access. Client can SELECT
-- their own document and UPDATE signature_status when
-- responding via DocuSign/Signwell callback flow.
DROP POLICY IF EXISTS cd_select_member       ON client_documents;
DROP POLICY IF EXISTS cd_select_client       ON client_documents;
DROP POLICY IF EXISTS cd_select_super_admin  ON client_documents;
DROP POLICY IF EXISTS cd_insert_member       ON client_documents;
DROP POLICY IF EXISTS cd_insert_super_admin  ON client_documents;
DROP POLICY IF EXISTS cd_update_member       ON client_documents;
DROP POLICY IF EXISTS cd_update_client       ON client_documents;
DROP POLICY IF EXISTS cd_update_super_admin  ON client_documents;
DROP POLICY IF EXISTS cd_delete_manager      ON client_documents;
DROP POLICY IF EXISTS cd_delete_super_admin  ON client_documents;

CREATE POLICY cd_select_member ON client_documents FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY cd_select_client ON client_documents FOR SELECT USING (
  client_account_id = current_user_id() AND current_user_type() = 'client');
CREATE POLICY cd_select_super_admin ON client_documents FOR SELECT USING (is_super_admin());

CREATE POLICY cd_insert_member ON client_documents FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY cd_insert_super_admin ON client_documents FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY cd_update_member ON client_documents FOR UPDATE
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY cd_update_client ON client_documents FOR UPDATE
  USING (client_account_id = current_user_id() AND current_user_type() = 'client')
  WITH CHECK (client_account_id = current_user_id() AND current_user_type() = 'client');
CREATE POLICY cd_update_super_admin ON client_documents FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY cd_delete_manager ON client_documents FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = client_documents.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY cd_delete_super_admin ON client_documents FOR DELETE USING (is_super_admin());
