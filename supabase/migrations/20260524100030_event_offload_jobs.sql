-- Phase 3 Unit 7: event_offload_jobs (spec 18.1.2).
-- Cloud-offload jobs that move completed-event media to a tenant's external
-- storage. 5-state machine. Partial UNIQUE (event_id) WHERE active blocks
-- two queued/running jobs per event. Trigger enforces event + storage
-- tenants match job's tenant.

CREATE TABLE event_offload_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_id        uuid        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  storage_id      uuid        REFERENCES tenant_external_storage (id) ON DELETE SET NULL,
  status          text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  bytes_offloaded bigint      CHECK (bytes_offloaded IS NULL OR bytes_offloaded >= 0),
  files_count     integer     CHECK (files_count     IS NULL OR files_count     >= 0),
  started_at      timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  cancelled_by    uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  error_message   text        CHECK (error_message IS NULL OR length(error_message) <= 2000),
  attempt_count   integer     NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 50),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'running'   OR started_at IS NOT NULL),
  CHECK (status <> 'completed' OR (started_at IS NOT NULL AND completed_at IS NOT NULL AND bytes_offloaded IS NOT NULL AND files_count IS NOT NULL)),
  CHECK (status <> 'failed'    OR (started_at IS NOT NULL AND completed_at IS NOT NULL AND error_message IS NOT NULL)),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE UNIQUE INDEX uq_offload_jobs_event_active
  ON event_offload_jobs (event_id) WHERE status IN ('queued','running');

CREATE INDEX idx_offload_jobs_event   ON event_offload_jobs (event_id);
CREATE INDEX idx_offload_jobs_tenant  ON event_offload_jobs (tenant_id, created_at DESC);
CREATE INDEX idx_offload_jobs_pending ON event_offload_jobs (status, created_at) WHERE status IN ('queued','running');
CREATE INDEX idx_offload_jobs_storage ON event_offload_jobs (storage_id) WHERE storage_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_event_offload_jobs_tenant_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event_tenant   uuid;
  storage_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL OR event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'event_offload_jobs_tenant_mismatch: event tenant (%) <> job tenant (%)',
                    event_tenant, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.storage_id IS NOT NULL THEN
    SELECT tenant_id INTO storage_tenant FROM tenant_external_storage WHERE id = NEW.storage_id;
    IF storage_tenant IS NULL OR storage_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'event_offload_jobs_storage_tenant_mismatch: storage tenant (%) <> job tenant (%)',
                      storage_tenant, NEW.tenant_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_offload_jobs_tenant_match
BEFORE INSERT OR UPDATE OF tenant_id, event_id, storage_id ON event_offload_jobs
FOR EACH ROW EXECUTE FUNCTION trg_event_offload_jobs_tenant_match();

ALTER TABLE event_offload_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_offload_jobs FORCE ROW LEVEL SECURITY;
