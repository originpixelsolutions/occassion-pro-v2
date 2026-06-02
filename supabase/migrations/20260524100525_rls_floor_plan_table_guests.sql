-- Phase 12 Unit 100c: RLS on floor_plan_table_guests.
-- Junction table - join through floor_plan_tables -> floor_plans.
DROP POLICY IF EXISTS fptg_select_member       ON floor_plan_table_guests;
DROP POLICY IF EXISTS fptg_select_super_admin  ON floor_plan_table_guests;
DROP POLICY IF EXISTS fptg_insert_member       ON floor_plan_table_guests;
DROP POLICY IF EXISTS fptg_insert_super_admin  ON floor_plan_table_guests;
DROP POLICY IF EXISTS fptg_delete_member       ON floor_plan_table_guests;
DROP POLICY IF EXISTS fptg_delete_super_admin  ON floor_plan_table_guests;

CREATE POLICY fptg_select_member ON floor_plan_table_guests FOR SELECT USING (
  EXISTS (SELECT 1 FROM floor_plan_tables fpt JOIN floor_plans fp ON fp.id = fpt.floor_plan_id
    WHERE fpt.id = floor_plan_table_guests.table_id AND is_tenant_member(fp.tenant_id)));
CREATE POLICY fptg_select_super_admin ON floor_plan_table_guests FOR SELECT USING (is_super_admin());
CREATE POLICY fptg_insert_member ON floor_plan_table_guests FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM floor_plan_tables fpt JOIN floor_plans fp ON fp.id = fpt.floor_plan_id
    WHERE fpt.id = floor_plan_table_guests.table_id AND is_tenant_member(fp.tenant_id)));
CREATE POLICY fptg_insert_super_admin ON floor_plan_table_guests FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY fptg_delete_member ON floor_plan_table_guests FOR DELETE USING (
  EXISTS (SELECT 1 FROM floor_plan_tables fpt JOIN floor_plans fp ON fp.id = fpt.floor_plan_id
    WHERE fpt.id = floor_plan_table_guests.table_id AND is_tenant_member(fp.tenant_id)));
CREATE POLICY fptg_delete_super_admin ON floor_plan_table_guests FOR DELETE USING (is_super_admin());
