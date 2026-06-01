-- Phase 7 Unit 49: storage_archive_events (spec 18.1 line 3161).
-- Batch archive events. Each row represents one archive
-- operation (lifecycle sweep, manual archive, tenant-
-- requested cold storage, quota-pressure offload, retention
-- policy enforcement, or tenant offload).
--
-- Six-state machine:
--   in_progress -> completed -> restoring -> restored
--                            -> purged
--   in_progress -> failed
--
-- Per-state prereq CHECKs:
--   restoring : restore_requested_at NOT NULL
--   restored  : restored_at AND restored_bytes AND
--               restored_file_count NOT NULL
--   purged    : purged_at NOT NULL
--   failed    : failed_at AND failure_reason NOT NULL
-- Plus restored_at >= restore_requested_at and
-- restored_bytes <= bytes_archived (can't restore more than
-- was archived).
--
-- restore_window_ends_at MUST be after archived_at (sanity)
-- and powers the spec's grace-flow for tenants to restore
-- before purge.
--
-- archive_type enum (6 values) captures the WHY: lifecycle
-- (automated sweep), manual, tenant_request, quota_pressure,
-- retention_policy, offload (to external cloud).
-- archive_destination enum (5 values) matches storage_objects.
--
-- cost_estimate_usd (4-decimal precision for fractional cents)
-- supports per-archive cost telemetry. job_id captures the
-- gateway's batch ID for webhook reconciliation.

CREATE TABLE storage_archive_events (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id               uuid        REFERENCES events(id) ON DELETE SET NULL,
  archive_type           text        NOT NULL DEFAULT 'lifecycle' CHECK (archive_type IN ('lifecycle','manual','tenant_request','quota_pressure','retention_policy','offload')),
  archive_destination    text        NOT NULL CHECK (archive_destination IN ('r2_archive','s3_glacier','b2_archive','wasabi','azure_archive')),
  bytes_archived         bigint      NOT NULL CHECK (bytes_archived > 0),
  file_count             integer     NOT NULL CHECK (file_count > 0),
  status                 text        NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress','completed','restoring','restored','purged','failed')),
  archived_at            timestamptz NOT NULL DEFAULT now(),
  restore_window_ends_at timestamptz NOT NULL,
  restore_requested_at   timestamptz,
  restore_requested_by   uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  restored_at            timestamptz,
  restored_bytes         bigint      CHECK (restored_bytes IS NULL OR restored_bytes >= 0),
  restored_file_count    integer     CHECK (restored_file_count IS NULL OR restored_file_count >= 0),
  purged_at              timestamptz,
  failed_at              timestamptz,
  failure_reason         text        CHECK (failure_reason IS NULL OR length(failure_reason) <= 2000),
  cost_estimate_usd      numeric(10,4) CHECK (cost_estimate_usd IS NULL OR cost_estimate_usd >= 0),
  job_id                 text        CHECK (job_id IS NULL OR length(job_id) BETWEEN 1 AND 256),
  notes                  text        CHECK (notes IS NULL OR length(notes) <= 4000),
  metadata               jsonb       CHECK (metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) < 32768)),
  initiated_by           uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (restore_window_ends_at > archived_at),
  CHECK (status <> 'restoring' OR restore_requested_at IS NOT NULL),
  CHECK (status <> 'restored'  OR (restored_at IS NOT NULL AND restored_bytes IS NOT NULL AND restored_file_count IS NOT NULL)),
  CHECK (status <> 'purged'    OR purged_at IS NOT NULL),
  CHECK (status <> 'failed'    OR (failed_at IS NOT NULL AND failure_reason IS NOT NULL)),
  CHECK (restored_at IS NULL OR (restore_requested_at IS NOT NULL AND restored_at >= restore_requested_at)),
  CHECK (purged_at IS NULL OR purged_at >= archived_at),
  CHECK (restored_bytes IS NULL OR restored_bytes <= bytes_archived),
  CHECK (restored_file_count IS NULL OR restored_file_count <= file_count)
);

CREATE INDEX idx_archive_events_tenant_time ON storage_archive_events (tenant_id, archived_at DESC);
CREATE INDEX idx_archive_events_event       ON storage_archive_events (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_archive_events_status      ON storage_archive_events (tenant_id, status, archived_at DESC);
CREATE INDEX idx_archive_events_restore_due ON storage_archive_events (restore_window_ends_at) WHERE status = 'completed';
CREATE INDEX idx_archive_events_initiator   ON storage_archive_events (initiated_by) WHERE initiated_by IS NOT NULL;
CREATE INDEX idx_archive_events_job_id      ON storage_archive_events (archive_destination, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_archive_events_failed      ON storage_archive_events (tenant_id, failed_at DESC) WHERE status = 'failed';

CREATE OR REPLACE FUNCTION storage_archive_events_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; req_tenant uuid; init_tenant uuid;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
    IF event_tenant IS NULL THEN
      RAISE EXCEPTION 'storage_archive_events.event_id % not found', NEW.event_id USING ERRCODE = '23503';
    END IF;
    IF event_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'storage_archive_events.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.restore_requested_by IS NOT NULL THEN
    SELECT tenant_id INTO req_tenant FROM tenant_members WHERE id = NEW.restore_requested_by;
    IF req_tenant IS NULL OR req_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'storage_archive_events.restore_requested_by % does not belong to tenant %', NEW.restore_requested_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.initiated_by IS NOT NULL THEN
    SELECT tenant_id INTO init_tenant FROM tenant_members WHERE id = NEW.initiated_by;
    IF init_tenant IS NULL OR init_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'storage_archive_events.initiated_by % does not belong to tenant %', NEW.initiated_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_storage_archive_events_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, restore_requested_by, initiated_by ON storage_archive_events
  FOR EACH ROW EXECUTE FUNCTION storage_archive_events_check_tenant_match();

ALTER TABLE storage_archive_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_archive_events FORCE ROW LEVEL SECURITY;
