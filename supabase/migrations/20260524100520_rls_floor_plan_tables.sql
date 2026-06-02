-- Phase 12 Unit 100b: RLS on floor_plan_tables.
-- Join-through-parent (floor_plans) for tenant scope.
DROP POLICY IF EXISTS fpt_select_member       ON floor_plan_tables;
DROP POLICY IF EXISTS fpt_select_super_admin  ON floor_plan_tables;
DROP POLICY IF EXISTS fpt_insert_member       ON floor_plan_tables;
DROP POLICY IF EXISTS fpt_insert_super_admin  ON floor_plan_tables;
DROP POLICY IF EXISTS fpt_update_member       ON floor_plan_tables;
DROP POLICY IF EXISTS fpt_update_super_admin  ON floor_plan_tables;
DROP POLICY IF EXISTS fpt_delete_member       ON floor_plan_tables;
DROP POLICY IF EXISTS fpt_delete_super_admin  ON floor_plan_tables;

CREATE POLICY fpt_select_member ON floor_plan_tables FOR SELECT USING (
  EXISTS (SELECT 1 FROM floor_plans fp WHERE fp.id = floor_plan_tables.floor_plan_id AND is_tenant_member(fp.tenant_id)));
CREATE POLICY fpt_select_super_admin ON floor_plan_tables FOR SELECT USING (is_super_admin());
CREATE POLICY fpt_insert_member ON floor_plan_tables FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM floor_plans fp WHERE fp.id = floor_plan_tables.floor_plan_id AND is_tenant_member(fp.tenant_id)));
CREATE POLICY fpt_insert_super_admin ON floor_plan_tables FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY fpt_update_member ON floor_plan_tables FOR UPDATE
  USING (EXISTS (SELECT 1 FROM floor_plans fp WHERE fp.id = floor_plan_tables.floor_plan_id AND is_tenant_member(fp.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM floor_plans fp WHERE fp.id = floor_plan_tables.floor_plan_id AND is_tenant_member(fp.tenant_id)));
CREATE POLICY fpt_update_super_admin ON floor_plan_tables FOR UPDATE
  USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY fpt_delete_member ON floor_plan_tables FOR DELETE USING (
  EXISTS (SELECT 1 FROM floor_plans fp WHERE fp.id = floor_plan_tables.floor_plan_id AND is_tenant_member(fp.tenant_id)));
CREATE POLICY fpt_delete_super_admin ON floor_plan_tables FOR DELETE USING (is_super_admin());
