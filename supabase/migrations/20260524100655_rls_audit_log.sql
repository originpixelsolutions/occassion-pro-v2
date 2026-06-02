-- Phase 12 Unit 108c: RLS on audit_log.
-- super_admin full read; tenant owner reads own tenant
-- (compliance UI). INSERT only via the SECURITY DEFINER
-- insert_audit_log() function (Unit 62); super_admin direct
-- INSERT as escape hatch. UPDATE/DELETE are blocked at the
-- trigger layer (audit_log_immutable_guard - Unit 61).
DROP POLICY IF EXISTS al_select_super_admin   ON audit_log;
DROP POLICY IF EXISTS al_select_tenant_owner  ON audit_log;
DROP POLICY IF EXISTS al_insert_super_admin   ON audit_log;
CREATE POLICY al_select_super_admin ON audit_log FOR SELECT USING (is_super_admin());
CREATE POLICY al_select_tenant_owner ON audit_log FOR SELECT USING (
  tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM tenant_members tm
    WHERE tm.id = current_user_id() AND tm.tenant_id = audit_log.tenant_id
      AND tm.role = 'owner' AND tm.removed_at IS NULL));
CREATE POLICY al_insert_super_admin ON audit_log FOR INSERT WITH CHECK (is_super_admin());
