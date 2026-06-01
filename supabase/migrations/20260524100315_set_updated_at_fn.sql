-- Phase 11 Unit 63: set_updated_at() trigger function +
-- bulk-attach to every table that owns an updated_at
-- column. Spec Part 27 (audit & change tracking) mandates
-- updated_at must always reflect last mutation - hand-rolled
-- application updates are forbidden.
--
-- IS DISTINCT FROM OLD short-circuit means a no-op UPDATE
-- (same values) does not bump the timestamp - keeps
-- idempotent reconciles and webhook retries from looking
-- like edits in the activity feed.
--
-- DO $attach$ enumerates every table in public with an
-- updated_at column (excluding audit_log and its partitions,
-- which are append-only) and attaches the trigger. Idempotent
-- via DROP TRIGGER IF EXISTS so re-running the migration is
-- safe; any future table added with an updated_at column
-- gets the trigger when this migration is re-applied via
-- the Phase 11 maintenance job.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $body$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$body$;

DO $attach$
DECLARE
  v_table text;
BEGIN
  FOR v_table IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT LIKE 'audit_log_%'
      AND c.table_name <> 'audit_log'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_set_updated_at ON %I; CREATE TRIGGER trg_%I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      v_table, v_table, v_table, v_table);
  END LOOP;
END
$attach$;
