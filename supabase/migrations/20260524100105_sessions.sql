-- Phase 3 Unit 22a: sessions (spec line 2501).
-- Per-event session row used by conferences (keynote, panel,
-- workshop, breakout, networking, exhibition). Backbone for
-- speaker_event_assignments and (later) public event website
-- agenda blocks. Tenant-scoped via events.tenant_id with the
-- standard cross-tenant trigger.
--
-- Key constraints: ends_at > starts_at (no zero/negative
-- sessions), cpd_credits requires is_cpd_eligible=TRUE,
-- streaming/recording URLs HTTPS only, language_code matches
-- BCP-47-ish ^[a-z]{2,3}(-[A-Z]{2})?$, is_published requires
-- published_at (no published-but-undated rows), soft-delete
-- trio.

CREATE TABLE sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  track               text        CHECK (track IS NULL OR length(trim(track)) BETWEEN 1 AND 80),
  session_type        text        NOT NULL DEFAULT 'breakout' CHECK (session_type IN ('keynote','panel','workshop','breakout','networking','exhibition')),
  title               text        NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  description         text        CHECK (description IS NULL OR length(description) <= 8000),
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  room                text        CHECK (room IS NULL OR length(trim(room)) BETWEEN 1 AND 100),
  capacity            integer     CHECK (capacity IS NULL OR capacity > 0),
  is_cpd_eligible     boolean     NOT NULL DEFAULT FALSE,
  cpd_credits         numeric(4,2) CHECK (cpd_credits IS NULL OR (cpd_credits > 0 AND cpd_credits <= 99.99)),
  is_published        boolean     NOT NULL DEFAULT FALSE,
  published_at        timestamptz,
  streaming_url       text        CHECK (streaming_url IS NULL OR (streaming_url ~ '^https://' AND length(streaming_url) BETWEEN 1 AND 2048)),
  recording_url       text        CHECK (recording_url IS NULL OR (recording_url ~ '^https://' AND length(recording_url) BETWEEN 1 AND 2048)),
  language_code       varchar(8)  CHECK (language_code IS NULL OR language_code ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  deleted_at          timestamptz,
  purge_after         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (cpd_credits IS NULL OR is_cpd_eligible = TRUE),
  CHECK (is_published = FALSE OR published_at IS NOT NULL),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_sessions_event_time   ON sessions (event_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_sessions_tenant       ON sessions (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sessions_track        ON sessions (event_id, track) WHERE track IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_sessions_published    ON sessions (event_id, starts_at) WHERE is_published = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_sessions_type         ON sessions (event_id, session_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_sessions_purge_due    ON sessions (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION sessions_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'sessions.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'sessions.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sessions_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id ON sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_check_tenant_match();

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
