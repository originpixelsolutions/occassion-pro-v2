-- Phase 12 Unit 93: RLS on guest_otps.
--
-- SECURITY-CRITICAL: OTP hash material. service_role (the
-- API server) creates, verifies, and consumes OTPs with
-- BYPASSRLS. The policy layer is super_admin-only -
-- forensic visibility for the platform team. NO tenant_member
-- and NO guest can read OTP rows from the DB.

DROP POLICY IF EXISTS gotp_select_super_admin   ON guest_otps;
DROP POLICY IF EXISTS gotp_insert_super_admin   ON guest_otps;
DROP POLICY IF EXISTS gotp_update_super_admin   ON guest_otps;
DROP POLICY IF EXISTS gotp_delete_super_admin   ON guest_otps;

CREATE POLICY gotp_select_super_admin ON guest_otps FOR SELECT USING (is_super_admin());
CREATE POLICY gotp_insert_super_admin ON guest_otps FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY gotp_update_super_admin ON guest_otps FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY gotp_delete_super_admin ON guest_otps FOR DELETE USING (is_super_admin());
