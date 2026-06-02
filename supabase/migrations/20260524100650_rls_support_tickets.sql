-- Phase 12 Unit 108b: RLS on support_tickets. Each user
-- sees own tickets; super_admin sees all.
DROP POLICY IF EXISTS st_select_self           ON support_tickets;
DROP POLICY IF EXISTS st_select_super_admin    ON support_tickets;
DROP POLICY IF EXISTS st_insert_self           ON support_tickets;
DROP POLICY IF EXISTS st_insert_super_admin    ON support_tickets;
DROP POLICY IF EXISTS st_update_self           ON support_tickets;
DROP POLICY IF EXISTS st_update_super_admin    ON support_tickets;
DROP POLICY IF EXISTS st_delete_super_admin    ON support_tickets;
CREATE POLICY st_select_self ON support_tickets FOR SELECT USING (user_id = current_user_id() AND user_type = current_user_type());
CREATE POLICY st_select_super_admin ON support_tickets FOR SELECT USING (is_super_admin());
CREATE POLICY st_insert_self ON support_tickets FOR INSERT WITH CHECK (user_id = current_user_id() AND user_type = current_user_type());
CREATE POLICY st_insert_super_admin ON support_tickets FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY st_update_self ON support_tickets FOR UPDATE
  USING (user_id = current_user_id() AND user_type = current_user_type())
  WITH CHECK (user_id = current_user_id() AND user_type = current_user_type());
CREATE POLICY st_update_super_admin ON support_tickets FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY st_delete_super_admin ON support_tickets FOR DELETE USING (is_super_admin());
