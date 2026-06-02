-- Phase 12 Unit 85: RLS on client_accounts.
-- Cross-tenant identity table. No tenant_id - the row is
-- the global identity of a client (couple, host, etc.) who
-- may be linked to one or more tenants' events through
-- client_event_access.
--
-- Visibility model:
--   self:              own row only
--   super_admin:       all
--   tenant_member:     clients linked into their tenant via a
--                      non-revoked client_event_access row
--   anon:              none
--
-- Self-signup INSERT (anyone with NULL current_user_id) is
-- allowed - the Supabase Auth flow creates the row before
-- handing the caller a session.

DROP POLICY IF EXISTS ca_select_self          ON client_accounts;
DROP POLICY IF EXISTS ca_select_super_admin   ON client_accounts;
DROP POLICY IF EXISTS ca_select_linked_member ON client_accounts;
DROP POLICY IF EXISTS ca_insert_super_admin   ON client_accounts;
DROP POLICY IF EXISTS ca_insert_self_signup   ON client_accounts;
DROP POLICY IF EXISTS ca_update_self          ON client_accounts;
DROP POLICY IF EXISTS ca_update_super_admin   ON client_accounts;
DROP POLICY IF EXISTS ca_delete_super_admin   ON client_accounts;

CREATE POLICY ca_select_self ON client_accounts
  FOR SELECT USING (id = current_user_id() AND current_user_type() = 'client');

CREATE POLICY ca_select_super_admin ON client_accounts
  FOR SELECT USING (is_super_admin());

CREATE POLICY ca_select_linked_member ON client_accounts FOR SELECT USING (
  EXISTS (SELECT 1 FROM client_event_access cea
    WHERE cea.client_account_id = client_accounts.id
      AND is_tenant_member(cea.tenant_id)
      AND cea.revoked_at IS NULL));

CREATE POLICY ca_insert_self_signup ON client_accounts FOR INSERT WITH CHECK (current_user_id() IS NULL);

CREATE POLICY ca_insert_super_admin ON client_accounts FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY ca_update_self ON client_accounts FOR UPDATE
  USING (id = current_user_id() AND current_user_type() = 'client')
  WITH CHECK (id = current_user_id() AND current_user_type() = 'client');

CREATE POLICY ca_update_super_admin ON client_accounts FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY ca_delete_super_admin ON client_accounts FOR DELETE USING (is_super_admin());
