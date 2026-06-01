-- Phase 12 Unit 66: RLS policies on tenants.
--
-- tenants is the root of the multi-tenant tree. Visibility:
--   - tenant_member: their own tenant only (predicate uses
--     the row's own id via is_tenant_member(id))
--   - super_admin: every tenant
--   - anonymous, guest, client, vendor, speaker: none
--   - service_role: bypasses RLS (BYPASSRLS attribute)
--
-- INSERT/DELETE locked to super_admin. UPDATE allowed for
-- the tenant's own members (to edit company_name, branding,
-- etc.) and for super_admins (platform overrides).
--
-- DROP POLICY IF EXISTS makes the migration idempotent so
-- repeated runs (and any later policy refactor migrations)
-- never collide.

DROP POLICY IF EXISTS tenants_select_member       ON tenants;
DROP POLICY IF EXISTS tenants_select_super_admin  ON tenants;
DROP POLICY IF EXISTS tenants_update_member       ON tenants;
DROP POLICY IF EXISTS tenants_update_super_admin  ON tenants;
DROP POLICY IF EXISTS tenants_insert_super_admin  ON tenants;
DROP POLICY IF EXISTS tenants_delete_super_admin  ON tenants;

CREATE POLICY tenants_select_member ON tenants
  FOR SELECT
  USING (is_tenant_member(id));

CREATE POLICY tenants_select_super_admin ON tenants
  FOR SELECT
  USING (is_super_admin());

CREATE POLICY tenants_update_member ON tenants
  FOR UPDATE
  USING (is_tenant_member(id))
  WITH CHECK (is_tenant_member(id));

CREATE POLICY tenants_update_super_admin ON tenants
  FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY tenants_insert_super_admin ON tenants
  FOR INSERT
  WITH CHECK (is_super_admin());

CREATE POLICY tenants_delete_super_admin ON tenants
  FOR DELETE
  USING (is_super_admin());
