-- Phase 3 Unit 22: speaker_event_assignments (spec lines 2176-2186).
-- Per-session speaker assignment. Status state machine:
-- invited -> confirmed | declined | cancelled.
--
-- Per-state prereq CHECKs:
--   confirmed : confirmed_at NOT NULL
--   declined  : declined_at AND declined_reason NOT NULL
--   cancelled : cancelled_at AND cancelled_reason NOT NULL
--
-- role enum: speaker | moderator | panelist | keynote. honorarium
-- + currency_code two-way coupled. presentation_url HTTPS only.
-- bio_snapshot is captured at invitation time so the program
-- agenda doesn't change retroactively when the speaker edits
-- their profile.
--
-- Partial UNIQUE (speaker_account_id, session_id) WHERE
-- deleted_at IS NULL - a speaker can't hold two active
-- assignments on the same session (but soft-deleted reuse is
-- allowed). A speaker CAN hold multiple sessions per event.
--
-- Four-way tenant-match trigger: event.tenant_id, session.tenant_id,
-- session.event_id = event_id, and invited_by member's tenant
-- all match the assignment's tenant.

CREATE TABLE speaker_event_assignments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  speaker_account_id  uuid        NOT NULL REFERENCES speaker_accounts(id) ON DELETE CASCADE,
  session_id          uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role                text        NOT NULL DEFAULT 'speaker' CHECK (role IN ('speaker','moderator','panelist','keynote')),
  status              text        NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','confirmed','declined','cancelled')),
  invited_by          uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  invited_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  declined_at         timestamptz,
  declined_reason     text        CHECK (declined_reason IS NULL OR length(declined_reason) <= 2000),
  cancelled_at        timestamptz,
  cancelled_reason    text        CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  honorarium          numeric(14,2) CHECK (honorarium IS NULL OR honorarium >= 0),
  currency_code       varchar(3)  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  travel_expenses_covered boolean NOT NULL DEFAULT FALSE,
  bio_snapshot        text        CHECK (bio_snapshot IS NULL OR length(bio_snapshot) <= 5000),
  presentation_url    text        CHECK (presentation_url IS NULL OR (presentation_url ~ '^https://' AND length(presentation_url) BETWEEN 1 AND 2048)),
  deleted_at          timestamptz,
  purge_after         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((honorarium IS NULL) = (currency_code IS NULL)),
  CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL),
  CHECK (status <> 'declined'  OR (declined_at IS NOT NULL AND declined_reason IS NOT NULL)),
  CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_speaker_event_assignments_active
  ON speaker_event_assignments (speaker_account_id, session_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_speaker_assignments_speaker  ON speaker_event_assignments (speaker_account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_speaker_assignments_session  ON speaker_event_assignments (session_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_speaker_assignments_event    ON speaker_event_assignments (event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_speaker_assignments_tenant   ON speaker_event_assignments (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_speaker_assignments_status   ON speaker_event_assignments (event_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_speaker_assignments_inviter  ON speaker_event_assignments (invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX idx_speaker_assignments_purge    ON speaker_event_assignments (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION speaker_event_assignments_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; session_tenant uuid; session_event uuid; inviter_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  SELECT tenant_id, event_id INTO session_tenant, session_event FROM sessions WHERE id = NEW.session_id;
  IF event_tenant IS NULL OR session_tenant IS NULL THEN
    RAISE EXCEPTION 'speaker_event_assignments parent rows not found' USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id OR session_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'speaker_event_assignments.tenant_id % does not match event/session tenants', NEW.tenant_id USING ERRCODE = '23514';
  END IF;
  IF session_event <> NEW.event_id THEN
    RAISE EXCEPTION 'speaker_event_assignments.session_id % belongs to event %, not %', NEW.session_id, session_event, NEW.event_id USING ERRCODE = '23514';
  END IF;
  IF NEW.invited_by IS NOT NULL THEN
    SELECT tenant_id INTO inviter_tenant FROM tenant_members WHERE id = NEW.invited_by;
    IF inviter_tenant IS NULL OR inviter_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'speaker_event_assignments.invited_by % does not belong to tenant %', NEW.invited_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_speaker_event_assignments_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, session_id, invited_by ON speaker_event_assignments
  FOR EACH ROW EXECUTE FUNCTION speaker_event_assignments_check_tenant_match();

ALTER TABLE speaker_event_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE speaker_event_assignments FORCE ROW LEVEL SECURITY;
