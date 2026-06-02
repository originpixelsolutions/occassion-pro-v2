-- Phase 12 Unit 101d: RLS on vendor_reviews.
-- Public marketplace reads. Tenant_member of the event
-- tenant can write reviews; vendor can respond on own
-- review.
DROP POLICY IF EXISTS vr_select_public        ON vendor_reviews;
DROP POLICY IF EXISTS vr_select_super_admin   ON vendor_reviews;
DROP POLICY IF EXISTS vr_insert_member        ON vendor_reviews;
DROP POLICY IF EXISTS vr_insert_super_admin   ON vendor_reviews;
DROP POLICY IF EXISTS vr_update_member        ON vendor_reviews;
DROP POLICY IF EXISTS vr_update_vendor        ON vendor_reviews;
DROP POLICY IF EXISTS vr_update_super_admin   ON vendor_reviews;
DROP POLICY IF EXISTS vr_delete_super_admin   ON vendor_reviews;
CREATE POLICY vr_select_public ON vendor_reviews FOR SELECT USING (TRUE);
CREATE POLICY vr_select_super_admin ON vendor_reviews FOR SELECT USING (is_super_admin());
CREATE POLICY vr_insert_member ON vendor_reviews FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM events e WHERE e.id = vendor_reviews.event_id AND is_tenant_member(e.tenant_id)));
CREATE POLICY vr_insert_super_admin ON vendor_reviews FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY vr_update_member ON vendor_reviews FOR UPDATE
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = vendor_reviews.event_id AND is_tenant_member(e.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = vendor_reviews.event_id AND is_tenant_member(e.tenant_id)));
CREATE POLICY vr_update_vendor ON vendor_reviews FOR UPDATE
  USING (vendor_account_id = current_user_id() AND current_user_type() = 'vendor')
  WITH CHECK (vendor_account_id = current_user_id() AND current_user_type() = 'vendor');
CREATE POLICY vr_update_super_admin ON vendor_reviews FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vr_delete_super_admin ON vendor_reviews FOR DELETE USING (is_super_admin());
