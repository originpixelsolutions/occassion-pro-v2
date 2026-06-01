-- Phase 11 Unit 62: insert_audit_log(...) function.
-- The canonical writer used by every per-module audit
-- trigger in this phase. SECURITY DEFINER so triggers
-- running as the row owner can write to the protected
-- audit_log relation under fixed search_path.
--
-- Args fully cover the audit_log surface so callers never
-- bypass the column CHECKs by hand-rolling INSERTs.
--
-- Returns the inserted audit_log.id (bigint). Trigger
-- callers can discard the value; programmatic callers may
-- want the id for correlation.
--
-- Defensive guard: action, resource_type, actor_type are
-- declared as defaults are required - raising 22004 keeps
-- buggy callers from inserting silent NULLs.

CREATE OR REPLACE FUNCTION insert_audit_log(
  p_actor_type     text,
  p_action         text,
  p_resource_type  text,
  p_actor_id       uuid    DEFAULT NULL,
  p_actor_label    text    DEFAULT NULL,
  p_tenant_id      uuid    DEFAULT NULL,
  p_resource_id    text    DEFAULT NULL,
  p_resource_label text    DEFAULT NULL,
  p_severity       text    DEFAULT 'info',
  p_status         text    DEFAULT 'success',
  p_failure_reason text    DEFAULT NULL,
  p_request_id     uuid    DEFAULT NULL,
  p_session_id     text    DEFAULT NULL,
  p_ip_address     inet    DEFAULT NULL,
  p_user_agent     text    DEFAULT NULL,
  p_source         text    DEFAULT 'app',
  p_changes        jsonb   DEFAULT NULL,
  p_metadata       jsonb   DEFAULT NULL,
  p_correlation_id uuid    DEFAULT NULL,
  p_impersonator_id uuid   DEFAULT NULL,
  p_retention_class text   DEFAULT 'standard',
  p_occurred_at    timestamptz DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_id          bigint;
  v_occurred_at timestamptz := COALESCE(p_occurred_at, now());
BEGIN
  IF p_action IS NULL OR p_resource_type IS NULL OR p_actor_type IS NULL THEN
    RAISE EXCEPTION 'insert_audit_log: action, resource_type, actor_type are required'
      USING ERRCODE = '22004';
  END IF;

  INSERT INTO audit_log (
    occurred_at, tenant_id, actor_type, actor_id, actor_label,
    action, resource_type, resource_id, resource_label,
    severity, status, failure_reason,
    request_id, session_id, ip_address, user_agent, source,
    changes, metadata, correlation_id, impersonator_id, retention_class
  ) VALUES (
    v_occurred_at, p_tenant_id, p_actor_type, p_actor_id, p_actor_label,
    p_action, p_resource_type, p_resource_id, p_resource_label,
    p_severity, p_status, p_failure_reason,
    p_request_id, p_session_id, p_ip_address, p_user_agent, p_source,
    p_changes, p_metadata, p_correlation_id, p_impersonator_id, p_retention_class
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$body$;

DO $grant$
BEGIN
  REVOKE ALL ON FUNCTION insert_audit_log(text, text, text, uuid, text, uuid, text, text, text, text, text, uuid, text, inet, text, text, jsonb, jsonb, uuid, uuid, text, timestamptz) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION insert_audit_log(text, text, text, uuid, text, uuid, text, text, text, text, text, uuid, text, inet, text, text, jsonb, jsonb, uuid, uuid, text, timestamptz) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION insert_audit_log(text, text, text, uuid, text, uuid, text, text, text, text, text, uuid, text, inet, text, text, jsonb, jsonb, uuid, uuid, text, timestamptz) TO authenticated;
  END IF;
END
$grant$;
