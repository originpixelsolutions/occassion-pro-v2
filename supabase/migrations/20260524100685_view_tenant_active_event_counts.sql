-- Phase 12 Unit 110b: tenant_active_event_counts view.
-- Per-tenant event tallies for dashboard widgets and quota
-- gating. security_invoker = TRUE so RLS on tenants and
-- events governs visibility per caller.
CREATE OR REPLACE VIEW tenant_active_event_counts
WITH (security_invoker = TRUE) AS
SELECT
  t.id                                                                                     AS tenant_id,
  count(*) FILTER (WHERE e.status NOT IN ('cancelled','archived','completed'))               AS active_count,
  count(*) FILTER (WHERE e.status = 'completed')                                             AS completed_count,
  count(*) FILTER (WHERE e.status = 'cancelled')                                             AS cancelled_count,
  count(*) FILTER (WHERE e.status = 'archived')                                              AS archived_count,
  count(*)                                                                                  AS total_count,
  max(e.updated_at)                                                                         AS last_event_updated_at
FROM tenants t
LEFT JOIN events e ON e.tenant_id = t.id
GROUP BY t.id;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON tenant_active_event_counts TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON tenant_active_event_counts TO service_role;
  END IF;
END
$grant$;
