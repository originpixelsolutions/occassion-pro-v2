-- Phase 12 Unit 90: RLS on speaker_accounts.
-- Cross-tenant identity (8th template, third use). self +
-- linked-tenant-member.
DROP POLICY IF EXISTS sa_select_self          ON speaker_accounts;
DROP POLICY IF EXISTS sa_select_super_admin   ON speaker_accounts;
DROP POLICY IF EXISTS sa_select_linked_member ON speaker_accounts;
DROP POLICY IF EXISTS sa_insert_self_signup   ON speaker_accounts;
DROP POLICY IF EXISTS sa_insert_super_admin   ON speaker_accounts;
DROP POLICY IF EXISTS sa_update_self          ON speaker_accounts;
DROP POLICY IF EXISTS sa_update_super_admin   ON speaker_accounts;
DROP POLICY IF EXISTS sa_delete_super_admin   ON speaker_accounts;

CREATE POLICY sa_select_self ON speaker_accounts
  FOR SELECT USING (id = current_user_id() AND current_user_type() = 'speaker');
CREATE POLICY sa_select_super_admin ON speaker_accounts
  FOR SELECT USING (is_super_admin());
CREATE POLICY sa_select_linked_member ON speaker_accounts FOR SELECT USING (
  EXISTS (SELECT 1 FROM speaker_event_assignments sea
    WHERE sea.speaker_account_id = speaker_accounts.id
      AND is_tenant_member(sea.tenant_id)
      AND sea.cancelled_at IS NULL));

CREATE POLICY sa_insert_self_signup ON speaker_accounts FOR INSERT WITH CHECK (current_user_id() IS NULL);
CREATE POLICY sa_insert_super_admin ON speaker_accounts FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY sa_update_self ON speaker_accounts FOR UPDATE
  USING (id = current_user_id() AND current_user_type() = 'speaker')
  WITH CHECK (id = current_user_id() AND current_user_type() = 'speaker');
CREATE POLICY sa_update_super_admin ON speaker_accounts FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY sa_delete_super_admin ON speaker_accounts FOR DELETE USING (is_super_admin());
