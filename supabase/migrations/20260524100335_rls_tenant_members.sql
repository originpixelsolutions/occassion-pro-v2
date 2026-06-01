-- Phase 12 Unit 67: RLS policies on tenant_members.
--
-- 10 policies on this table - more than tenants because the
-- self-row read/update path is distinct from the
-- owner-managing-others path.
--
-- SELECT:
--   tm_select_member       - any tenant_member of the same
--                            tenant can read the roster
--   tm_select_self         - self-read still works even if
--                            the broader member predicate
--                            misfires (defence in depth)
--   tm_select_super_admin  - platform sees everything
--
-- INSERT (invite/create):
--   tm_insert_owner        - only owner/admin role within
--                            the target tenant
--   tm_insert_super_admin  - platform bootstrap path
--
-- UPDATE:
--   tm_update_owner        - owner/admin manages others
--   tm_update_self         - user updates own profile
--   tm_update_super_admin  - platform overrides
--
-- DELETE (removal is normally soft via removed_at; hard
-- delete only via owner/admin or super_admin):
--   tm_delete_owner        - role-gated
--   tm_delete_super_admin  - platform path
--
-- Owner/admin predicates are self-referential subqueries
-- against tenant_members itself; Postgres handles these
-- via the bypass that policies cannot block sibling rows
-- inside the same policy evaluation.

DROP POLICY IF EXISTS tm_select_member       ON tenant_members;
DROP POLICY IF EXISTS tm_select_self          ON tenant_members;
DROP POLICY IF EXISTS tm_select_super_admin  ON tenant_members;
DROP POLICY IF EXISTS tm_insert_super_admin  ON tenant_members;
DROP POLICY IF EXISTS tm_insert_owner         ON tenant_members;
DROP POLICY IF EXISTS tm_update_super_admin  ON tenant_members;
DROP POLICY IF EXISTS tm_update_owner         ON tenant_members;
DROP POLICY IF EXISTS tm_update_self          ON tenant_members;
DROP POLICY IF EXISTS tm_delete_super_admin  ON tenant_members;
DROP POLICY IF EXISTS tm_delete_owner         ON tenant_members;

CREATE POLICY tm_select_member ON tenant_members
  FOR SELECT
  USING (is_tenant_member(tenant_id));

CREATE POLICY tm_select_self ON tenant_members
  FOR SELECT
  USING (id = current_user_id() AND current_user_type() = 'tenant_member');

CREATE POLICY tm_select_super_admin ON tenant_members
  FOR SELECT
  USING (is_super_admin());

CREATE POLICY tm_insert_owner ON tenant_members
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = tenant_members.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  );

CREATE POLICY tm_insert_super_admin ON tenant_members
  FOR INSERT
  WITH CHECK (is_super_admin());

CREATE POLICY tm_update_owner ON tenant_members
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = tenant_members.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = tenant_members.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  );

CREATE POLICY tm_update_self ON tenant_members
  FOR UPDATE
  USING (id = current_user_id() AND current_user_type() = 'tenant_member')
  WITH CHECK (id = current_user_id() AND current_user_type() = 'tenant_member');

CREATE POLICY tm_update_super_admin ON tenant_members
  FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY tm_delete_owner ON tenant_members
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = tenant_members.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  );

CREATE POLICY tm_delete_super_admin ON tenant_members
  FOR DELETE
  USING (is_super_admin());
