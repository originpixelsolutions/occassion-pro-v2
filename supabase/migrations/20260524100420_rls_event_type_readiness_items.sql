-- Phase 12 Unit 84: RLS on event_type_readiness_items.
-- Dual-scope (system/tenant) + join-through-parent
-- (event_types). Inherits scope from the parent event_types
-- row: system catalogue items are visible to any
-- authenticated caller; tenant items follow the
-- owner/event_manager role gate.

DROP POLICY IF EXISTS etri_select_system        ON event_type_readiness_items;
DROP POLICY IF EXISTS etri_select_member        ON event_type_readiness_items;
DROP POLICY IF EXISTS etri_select_super_admin   ON event_type_readiness_items;
DROP POLICY IF EXISTS etri_insert_super_admin   ON event_type_readiness_items;
DROP POLICY IF EXISTS etri_insert_manager       ON event_type_readiness_items;
DROP POLICY IF EXISTS etri_update_super_admin   ON event_type_readiness_items;
DROP POLICY IF EXISTS etri_update_manager       ON event_type_readiness_items;
DROP POLICY IF EXISTS etri_delete_super_admin   ON event_type_readiness_items;
DROP POLICY IF EXISTS etri_delete_manager       ON event_type_readiness_items;

CREATE POLICY etri_select_system ON event_type_readiness_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM event_types et WHERE et.id = event_type_readiness_items.event_type_id
    AND et.tenant_id IS NULL AND et.is_system = TRUE) AND is_authenticated());
CREATE POLICY etri_select_member ON event_type_readiness_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM event_types et WHERE et.id = event_type_readiness_items.event_type_id
    AND et.tenant_id IS NOT NULL AND is_tenant_member(et.tenant_id)));
CREATE POLICY etri_select_super_admin ON event_type_readiness_items FOR SELECT USING (is_super_admin());

CREATE POLICY etri_insert_super_admin ON event_type_readiness_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM event_types et WHERE et.id = event_type_readiness_items.event_type_id
    AND et.tenant_id IS NULL) AND is_super_admin());
CREATE POLICY etri_insert_manager ON event_type_readiness_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM event_types et JOIN tenant_members tm ON tm.tenant_id = et.tenant_id
    WHERE et.id = event_type_readiness_items.event_type_id
      AND tm.id = current_user_id()
      AND tm.role IN ('owner','event_manager')
      AND tm.removed_at IS NULL));

CREATE POLICY etri_update_super_admin ON event_type_readiness_items FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY etri_update_manager ON event_type_readiness_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM event_types et JOIN tenant_members tm ON tm.tenant_id = et.tenant_id
    WHERE et.id = event_type_readiness_items.event_type_id
      AND tm.id = current_user_id()
      AND tm.role IN ('owner','event_manager')
      AND tm.removed_at IS NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM event_types et JOIN tenant_members tm ON tm.tenant_id = et.tenant_id
    WHERE et.id = event_type_readiness_items.event_type_id
      AND tm.id = current_user_id()
      AND tm.role IN ('owner','event_manager')
      AND tm.removed_at IS NULL));

CREATE POLICY etri_delete_super_admin ON event_type_readiness_items FOR DELETE USING (is_super_admin());
CREATE POLICY etri_delete_manager ON event_type_readiness_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM event_types et JOIN tenant_members tm ON tm.tenant_id = et.tenant_id
    WHERE et.id = event_type_readiness_items.event_type_id
      AND tm.id = current_user_id()
      AND tm.role IN ('owner','event_manager')
      AND tm.removed_at IS NULL));
