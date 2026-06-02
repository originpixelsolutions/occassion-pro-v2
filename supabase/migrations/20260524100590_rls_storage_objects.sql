-- Phase 12 Unit 105a: RLS on storage_objects. Direct
-- tenant_id with broad tenant_member CRUD; manager-gated
-- DELETE; super_admin override.
DROP POLICY IF EXISTS so_select_member       ON storage_objects;
DROP POLICY IF EXISTS so_select_super_admin  ON storage_objects;
DROP POLICY IF EXISTS so_insert_member       ON storage_objects;
DROP POLICY IF EXISTS so_insert_super_admin  ON storage_objects;
DROP POLICY IF EXISTS so_update_member       ON storage_objects;
DROP POLICY IF EXISTS so_update_super_admin  ON storage_objects;
DROP POLICY IF EXISTS so_delete_manager      ON storage_objects;
DROP POLICY IF EXISTS so_delete_super_admin  ON storage_objects;
CREATE POLICY so_select_member ON storage_objects FOR SELECT USING (is_tenant_member(tenant_id));
CREATE POLICY so_select_super_admin ON storage_objects FOR SELECT USING (is_super_admin());
CREATE POLICY so_insert_member ON storage_objects FOR INSERT WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY so_insert_super_admin ON storage_objects FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY so_update_member ON storage_objects FOR UPDATE USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY so_update_super_admin ON storage_objects FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY so_delete_manager ON storage_objects FOR DELETE USING (
  EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.id = current_user_id()
    AND tm.tenant_id = storage_objects.tenant_id
    AND tm.role IN ('owner','event_manager') AND tm.removed_at IS NULL));
CREATE POLICY so_delete_super_admin ON storage_objects FOR DELETE USING (is_super_admin());
