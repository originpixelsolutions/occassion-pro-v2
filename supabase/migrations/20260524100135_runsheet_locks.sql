-- Phase 3 Unit 27: runsheet_locks (spec line 2292).
-- Per-event runsheet edit lock. PK = event_id makes this a
-- singleton per event - at most one active lock at a time, and
-- the row PRESENCE itself signals "locked" (no boolean column
-- needed). Releasing the lock = DELETE the row.
--
-- Optional expires_at (capped at +24h) lets the app place
-- time-bound locks that auto-expire if the locking user
-- abandons their session. reason text is for "publishing
-- final runsheet" / "post-event freeze" / etc.
--
-- Cross-tenant trigger validates event AND locked_by member
-- belong to the lock's tenant.

CREATE TABLE runsheet_locks (
  event_id     uuid        PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  locked_by    uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  locked_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  reason       text        CHECK (reason IS NULL OR length(reason) <= 500),
  CHECK (expires_at IS NULL OR expires_at > locked_at AND expires_at <= locked_at + interval '24 hours')
);

CREATE INDEX idx_runsheet_locks_tenant ON runsheet_locks (tenant_id);
CREATE INDEX idx_runsheet_locks_locker ON runsheet_locks (locked_by) WHERE locked_by IS NOT NULL;
CREATE INDEX idx_runsheet_locks_expiry ON runsheet_locks (expires_at) WHERE expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION runsheet_locks_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; locker_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'runsheet_locks.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'runsheet_locks.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  IF NEW.locked_by IS NOT NULL THEN
    SELECT tenant_id INTO locker_tenant FROM tenant_members WHERE id = NEW.locked_by;
    IF locker_tenant IS NULL OR locker_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'runsheet_locks.locked_by % does not belong to tenant %', NEW.locked_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_runsheet_locks_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, locked_by ON runsheet_locks
  FOR EACH ROW EXECUTE FUNCTION runsheet_locks_check_tenant_match();

ALTER TABLE runsheet_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE runsheet_locks FORCE ROW LEVEL SECURITY;
