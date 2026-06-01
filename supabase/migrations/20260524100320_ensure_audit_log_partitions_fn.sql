-- Phase 11 Unit 64: ensure_audit_log_partitions(p_months_ahead int).
-- Maintains the rolling forward window of monthly partitions
-- on audit_log. Called by an Inngest job on the 1st of every
-- month at 00:05 UTC to make sure partitions exist for the
-- next p_months_ahead months (default 12).
--
-- Idempotent: skips months whose partition already exists.
-- Returns the count of newly-created partitions so the job
-- can report telemetry.
--
-- Bound-checked: p_months_ahead is constrained to [1, 60]
-- to prevent runaway creation in a buggy call.
--
-- SECURITY DEFINER so the Inngest job's session role need
-- not own audit_log; SET search_path = public, pg_temp
-- prevents PATH-based hijack.
--
-- Migration also pre-creates the next 12 months from the
-- moment this migration runs, so the initial Inngest schedule
-- need not wait for the first month boundary to take effect.

CREATE OR REPLACE FUNCTION ensure_audit_log_partitions(p_months_ahead integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_month_start   date;
  v_next_month    date;
  v_partition_name text;
  v_created       integer := 0;
BEGIN
  IF p_months_ahead < 1 OR p_months_ahead > 60 THEN
    RAISE EXCEPTION 'p_months_ahead must be between 1 and 60, got %', p_months_ahead
      USING ERRCODE = '22023';
  END IF;

  FOR i IN 0..p_months_ahead LOOP
    v_month_start := date_trunc('month', (now() + (i || ' months')::interval))::date;
    v_next_month  := (v_month_start + INTERVAL '1 month')::date;
    v_partition_name := format('audit_log_%s', to_char(v_month_start, 'YYYY_MM'));

    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = v_partition_name AND relkind = 'r'
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        v_partition_name,
        v_month_start::timestamptz,
        v_next_month::timestamptz
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN v_created;
END;
$body$;

DO $grant$
BEGIN
  REVOKE ALL ON FUNCTION ensure_audit_log_partitions(integer) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION ensure_audit_log_partitions(integer) TO service_role;
  END IF;
END
$grant$;

-- Pre-create the next 12 months from migration time so the
-- table is ready for traffic even before the first Inngest
-- run.
SELECT ensure_audit_log_partitions(12);
