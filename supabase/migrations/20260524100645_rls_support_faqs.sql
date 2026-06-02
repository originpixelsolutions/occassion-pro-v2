-- Phase 12 Unit 108a: RLS on support_faqs. Visibility tiers
-- via the visibility column (public/authenticated/...).
DROP POLICY IF EXISTS sfaq_select_public        ON support_faqs;
DROP POLICY IF EXISTS sfaq_select_auth          ON support_faqs;
DROP POLICY IF EXISTS sfaq_select_super_admin   ON support_faqs;
DROP POLICY IF EXISTS sfaq_insert_super_admin   ON support_faqs;
DROP POLICY IF EXISTS sfaq_update_super_admin   ON support_faqs;
DROP POLICY IF EXISTS sfaq_delete_super_admin   ON support_faqs;
CREATE POLICY sfaq_select_public ON support_faqs FOR SELECT USING (is_active = TRUE AND deleted_at IS NULL AND visibility = 'public');
CREATE POLICY sfaq_select_auth ON support_faqs FOR SELECT USING (is_active = TRUE AND deleted_at IS NULL AND visibility IN ('public','authenticated') AND is_authenticated());
CREATE POLICY sfaq_select_super_admin ON support_faqs FOR SELECT USING (is_super_admin());
CREATE POLICY sfaq_insert_super_admin ON support_faqs FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY sfaq_update_super_admin ON support_faqs FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY sfaq_delete_super_admin ON support_faqs FOR DELETE USING (is_super_admin());
