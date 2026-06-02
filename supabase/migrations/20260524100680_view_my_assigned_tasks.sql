-- Phase 12 Unit 110a: my_assigned_tasks view.
-- The current authenticated tenant_member's open runsheet
-- tasks across all events they are tenant-attached to.
-- security_invoker = TRUE delegates RLS to the underlying
-- runsheet_tasks policies.
CREATE OR REPLACE VIEW my_assigned_tasks
WITH (security_invoker = TRUE) AS
SELECT
  rt.id,
  rt.tenant_id,
  rt.event_id,
  e.name              AS event_name,
  e.start_date        AS event_start_date,
  rt.title,
  rt.status,
  rt.priority,
  rt.scheduled_start,
  rt.scheduled_end,
  rt.actual_start,
  rt.actual_end,
  rt.blocked_reason,
  rt.updated_at
FROM runsheet_tasks rt
JOIN events e ON e.id = rt.event_id
WHERE rt.deleted_at IS NULL
  AND rt.status IN ('pending','blocked','in_progress')
  AND (
    rt.tenant_id IN (
      SELECT tm.tenant_id FROM tenant_members tm
      WHERE tm.id = current_user_id() AND tm.removed_at IS NULL
    )
  );
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON my_assigned_tasks TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON my_assigned_tasks TO service_role;
  END IF;
END
$grant$;
