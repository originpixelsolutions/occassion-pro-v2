-- Phase 12 Unit 68: RLS policies on events.
--
-- events is tenant-scoped via events.tenant_id - the standard
-- shape for the rest of Phase 12.
--
-- SELECT pair: tenant_member sees own tenant's events;
-- super_admin sees all.
--
-- INSERT: owner/event_manager only (creating events is a
-- management action). super_admin override for platform.
--
-- UPDATE: any non-revoked tenant_member can edit (assignment,
-- runsheet edits etc all flow through this). super_admin
-- override.
--
-- DELETE: owner/event_manager only (destructive). super_admin
-- override.

DROP POLICY IF EXISTS events_select_member       ON events;
DROP POLICY IF EXISTS events_select_super_admin  ON events;
DROP POLICY IF EXISTS events_insert_manager      ON events;
DROP POLICY IF EXISTS events_insert_super_admin  ON events;
DROP POLICY IF EXISTS events_update_member       ON events;
DROP POLICY IF EXISTS events_update_super_admin  ON events;
DROP POLICY IF EXISTS events_delete_manager      ON events;
DROP POLICY IF EXISTS events_delete_super_admin  ON events;

CREATE POLICY events_select_member ON events
  FOR SELECT USING (is_tenant_member(tenant_id));

CREATE POLICY events_select_super_admin ON events
  FOR SELECT USING (is_super_admin());

CREATE POLICY events_insert_manager ON events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = events.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  );

CREATE POLICY events_insert_super_admin ON events
  FOR INSERT WITH CHECK (is_super_admin());

CREATE POLICY events_update_member ON events
  FOR UPDATE
  USING (is_tenant_member(tenant_id))
  WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY events_update_super_admin ON events
  FOR UPDATE
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE POLICY events_delete_manager ON events
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.id = current_user_id()
        AND tm.tenant_id = events.tenant_id
        AND tm.role IN ('owner','event_manager')
        AND tm.removed_at IS NULL
    )
  );

CREATE POLICY events_delete_super_admin ON events
  FOR DELETE USING (is_super_admin());
