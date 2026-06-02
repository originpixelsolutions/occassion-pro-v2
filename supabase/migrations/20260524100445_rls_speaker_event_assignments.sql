-- Phase 12 Unit 89: RLS on speaker_event_assignments.
-- Cross-tenant link table. Same template as
-- vendor_event_assignments. Ships before speaker_accounts.
DROP POLICY IF EXISTS sea_select_member       ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_select_speaker      ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_select_super_admin  ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_insert_manager      ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_insert_super_admin  ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_update_manager      ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_update_speaker      ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_update_super_admin  ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_delete_manager      ON speaker_event_assignments;
DROP POLICY IF EXISTS sea_delete_super_admin  ON speaker_event_assignments;

CREATE POLICY sea_select_member ON speaker_event_assignments FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY sea_select_speaker ON speaker_event_assignments FOR SELECT USING (
  speaker_account_id = current_user_id() AND current_user_type() = 'speaker');
CREATE POLICY sea_select_super_admin ON speaker_event_assignments FOR SELECT USING (is_super_admin());

CREATE POLICY sea_insert_manager ON speaker_event_assignments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = speaker_event_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY sea_insert_super_admin ON speaker_event_assignments FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY sea_update_manager ON speaker_event_assignments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = speaker_event_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = speaker_event_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY sea_update_speaker ON speaker_event_assignments FOR UPDATE
  USING (speaker_account_id = current_user_id() AND current_user_type() = 'speaker')
  WITH CHECK (speaker_account_id = current_user_id() AND current_user_type() = 'speaker');
CREATE POLICY sea_update_super_admin ON speaker_event_assignments FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY sea_delete_manager ON speaker_event_assignments FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = speaker_event_assignments.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY sea_delete_super_admin ON speaker_event_assignments FOR DELETE USING (is_super_admin());
