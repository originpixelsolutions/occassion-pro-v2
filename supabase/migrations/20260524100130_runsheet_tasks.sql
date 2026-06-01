-- Phase 3 Unit 26: runsheet_tasks (spec lines 2245-2272).
-- Per-event runsheet items. Hierarchical (parent_task_id) AND
-- DAG-style sequencing (depends_on_id) — both self-FKs ON
-- DELETE SET NULL so deletion of a parent or upstream task
-- leaves children/dependents orphan-detached but still queryable.
--
-- Status state machine: pending -> in_progress -> completed
-- (also blocked, cancelled). priority enum: low/normal/high/
-- critical.
--
-- Per-state prereq CHECKs:
--   in_progress : actual_start NOT NULL
--   completed   : actual_start AND actual_end NOT NULL
--   blocked     : blocked_reason NOT NULL
--   cancelled   : cancelled_reason NOT NULL
-- Plus scheduled_end > scheduled_start when both present, and
-- actual_end >= actual_start.
--
-- Cycle prevention: BEFORE INSERT OR UPDATE OF depends_on_id
-- runs a recursive CTE chasing the dependency chain; if the
-- new row would close a cycle (chain reaches NEW.id), raise.
-- O(chain depth) per insert/update - acceptable; rare path.
--
-- Six-way tenant-match trigger validates every FK: event +
-- parent_task + depends_on + assignee member + subteam +
-- creator member all live in the task's tenant, AND
-- parent_task / depends_on / subteam are all bound to the
-- task's event_id (a task can't depend on another event's task).

CREATE TABLE runsheet_tasks (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id          uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  parent_task_id    uuid        REFERENCES runsheet_tasks(id) ON DELETE SET NULL,
  depends_on_id     uuid        REFERENCES runsheet_tasks(id) ON DELETE SET NULL,
  title             text        NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  description       text        CHECK (description IS NULL OR length(description) <= 8000),
  scheduled_start   timestamptz,
  scheduled_end     timestamptz,
  actual_start      timestamptz,
  actual_end        timestamptz,
  assigned_to       uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  subteam_id        uuid        REFERENCES event_subteams(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','blocked','in_progress','completed','cancelled')),
  priority          text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  sort_order        integer     NOT NULL DEFAULT 0,
  blocked_reason    text        CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 2000),
  cancelled_reason  text        CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  deleted_at        timestamptz,
  purge_after       timestamptz,
  created_by        uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_dependency CHECK (id <> depends_on_id),
  CONSTRAINT no_self_parent     CHECK (id <> parent_task_id),
  CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start),
  CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start),
  CHECK (status <> 'in_progress' OR actual_start IS NOT NULL),
  CHECK (status <> 'completed'   OR (actual_start IS NOT NULL AND actual_end IS NOT NULL)),
  CHECK (status <> 'blocked'     OR blocked_reason IS NOT NULL),
  CHECK (status <> 'cancelled'   OR cancelled_reason IS NOT NULL),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_runsheet_tasks_event_time ON runsheet_tasks (event_id, scheduled_start) WHERE deleted_at IS NULL;
CREATE INDEX idx_runsheet_tasks_assignee   ON runsheet_tasks (assigned_to) WHERE status NOT IN ('completed','cancelled') AND deleted_at IS NULL;
CREATE INDEX idx_runsheet_tasks_subteam    ON runsheet_tasks (subteam_id) WHERE subteam_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_runsheet_tasks_parent     ON runsheet_tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX idx_runsheet_tasks_depends    ON runsheet_tasks (depends_on_id) WHERE depends_on_id IS NOT NULL;
CREATE INDEX idx_runsheet_tasks_status     ON runsheet_tasks (event_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_runsheet_tasks_priority   ON runsheet_tasks (event_id, priority, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_runsheet_tasks_tenant     ON runsheet_tasks (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_runsheet_tasks_purge      ON runsheet_tasks (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_runsheet_task_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.depends_on_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE chain AS (
      SELECT id, depends_on_id FROM runsheet_tasks WHERE id = NEW.depends_on_id
      UNION ALL
      SELECT t.id, t.depends_on_id FROM runsheet_tasks t JOIN chain c ON t.id = c.depends_on_id
    ) SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'runsheet_tasks dependency cycle detected via task %', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_runsheet_task_cycle_check
  BEFORE INSERT OR UPDATE OF depends_on_id ON runsheet_tasks
  FOR EACH ROW EXECUTE FUNCTION prevent_runsheet_task_cycle();

CREATE OR REPLACE FUNCTION runsheet_tasks_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; parent_tenant uuid; parent_event uuid;
        dep_tenant uuid; dep_event uuid; assignee_tenant uuid;
        subteam_tenant uuid; subteam_event uuid; creator_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'runsheet_tasks.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'runsheet_tasks.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_task_id IS NOT NULL THEN
    SELECT tenant_id, event_id INTO parent_tenant, parent_event FROM runsheet_tasks WHERE id = NEW.parent_task_id;
    IF parent_tenant IS NULL THEN
      RAISE EXCEPTION 'runsheet_tasks.parent_task_id % not found', NEW.parent_task_id USING ERRCODE = '23503';
    END IF;
    IF parent_tenant <> NEW.tenant_id OR parent_event <> NEW.event_id THEN
      RAISE EXCEPTION 'runsheet_tasks.parent_task_id % does not match tenant/event', NEW.parent_task_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.depends_on_id IS NOT NULL THEN
    SELECT tenant_id, event_id INTO dep_tenant, dep_event FROM runsheet_tasks WHERE id = NEW.depends_on_id;
    IF dep_tenant IS NULL THEN
      RAISE EXCEPTION 'runsheet_tasks.depends_on_id % not found', NEW.depends_on_id USING ERRCODE = '23503';
    END IF;
    IF dep_tenant <> NEW.tenant_id OR dep_event <> NEW.event_id THEN
      RAISE EXCEPTION 'runsheet_tasks.depends_on_id % does not match tenant/event', NEW.depends_on_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.assigned_to IS NOT NULL THEN
    SELECT tenant_id INTO assignee_tenant FROM tenant_members WHERE id = NEW.assigned_to;
    IF assignee_tenant IS NULL OR assignee_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'runsheet_tasks.assigned_to % does not belong to tenant %', NEW.assigned_to, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.subteam_id IS NOT NULL THEN
    SELECT tenant_id, event_id INTO subteam_tenant, subteam_event FROM event_subteams WHERE id = NEW.subteam_id;
    IF subteam_tenant IS NULL OR subteam_tenant <> NEW.tenant_id OR subteam_event <> NEW.event_id THEN
      RAISE EXCEPTION 'runsheet_tasks.subteam_id % does not match tenant/event', NEW.subteam_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'runsheet_tasks.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_runsheet_tasks_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, parent_task_id, depends_on_id, assigned_to, subteam_id, created_by ON runsheet_tasks
  FOR EACH ROW EXECUTE FUNCTION runsheet_tasks_check_tenant_match();

ALTER TABLE runsheet_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE runsheet_tasks FORCE ROW LEVEL SECURITY;
