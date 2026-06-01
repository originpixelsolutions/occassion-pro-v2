-- Phase 12 Unit 69: RLS policies on super_admins.
--
-- super_admins is the platform-side identity table. Visibility
-- is strictly Super-Admin-only - no tenant identity ever sees
-- the platform roster.
--
-- 7-value role enum (owner, admin, engineering, support,
-- sales, finance, auditor). Management actions
-- (INSERT/UPDATE) are gated to owner+admin. DELETE is
-- locked to owner only.
--
-- SELECT pair:
--   sa_select_self          - self always sees own row
--   sa_select_super_admin   - any active super_admin sees
--                             the full roster
--
-- INSERT/UPDATE: owner/admin only via self-referential
-- predicate that excludes removed members.
--
-- UPDATE self: members can always edit their own row
-- (profile updates) regardless of role.
--
-- DELETE: owner only - the only platform identity allowed
-- to hard-delete another Super Admin. Routine removal goes
-- through removed_at (soft).
--
-- Note: there is no anonymous/tenant_member path - those
-- callers see ZERO super_admins via the absence of any
-- matching policy.

DROP POLICY IF EXISTS sa_select_self        ON super_admins;
DROP POLICY IF EXISTS sa_select_super_admin ON super_admins;
DROP POLICY IF EXISTS sa_insert_owner       ON super_admins;
DROP POLICY IF EXISTS sa_update_owner       ON super_admins;
DROP POLICY IF EXISTS sa_update_self        ON super_admins;
DROP POLICY IF EXISTS sa_delete_owner       ON super_admins;

CREATE POLICY sa_select_self ON super_admins
  FOR SELECT
  USING (id = current_user_id() AND current_user_type() = 'super_admin');

CREATE POLICY sa_select_super_admin ON super_admins
  FOR SELECT
  USING (is_super_admin());

CREATE POLICY sa_insert_owner ON super_admins
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM super_admins sa
      WHERE sa.id = current_user_id()
        AND sa.role IN ('owner','admin')
        AND sa.removed_at IS NULL
    )
  );

CREATE POLICY sa_update_owner ON super_admins
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM super_admins sa
      WHERE sa.id = current_user_id()
        AND sa.role IN ('owner','admin')
        AND sa.removed_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM super_admins sa
      WHERE sa.id = current_user_id()
        AND sa.role IN ('owner','admin')
        AND sa.removed_at IS NULL
    )
  );

CREATE POLICY sa_update_self ON super_admins
  FOR UPDATE
  USING (id = current_user_id() AND current_user_type() = 'super_admin')
  WITH CHECK (id = current_user_id() AND current_user_type() = 'super_admin');

CREATE POLICY sa_delete_owner ON super_admins
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM super_admins sa
      WHERE sa.id = current_user_id()
        AND sa.role = 'owner'
        AND sa.removed_at IS NULL
    )
  );
