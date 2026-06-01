-- Phase 3 Unit 6: event_edit_sessions (spec 4.6).
-- Field-level soft locks. Default 60-second TTL with heartbeat extending
-- up to a 1-hour ceiling. Partial UNIQUE (event_id, field_path) WHERE
-- released_at IS NULL blocks two simultaneous active locks on the same
-- field; released history persists for audit.

CREATE TABLE event_edit_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES tenant_members (id) ON DELETE CASCADE,
  field_path      text        NOT NULL CHECK (length(trim(field_path)) BETWEEN 1 AND 500),
  client_id       text        CHECK (client_id IS NULL OR length(trim(client_id)) BETWEEN 1 AND 120),
  user_agent      text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  locked_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + INTERVAL '60 seconds'),
  released_at     timestamptz,
  released_reason text        CHECK (released_reason IS NULL OR released_reason IN ('user','heartbeat_lost','takeover','admin_force','expired','session_ended')),
  CHECK (expires_at > locked_at),
  CHECK (expires_at <= locked_at + INTERVAL '1 hour'),
  CHECK (released_at IS NULL OR released_at >= locked_at),
  CHECK ((released_at IS NULL) = (released_reason IS NULL))
);

CREATE UNIQUE INDEX uq_event_edit_sessions_active
  ON event_edit_sessions (event_id, field_path) WHERE released_at IS NULL;

CREATE INDEX idx_edit_sessions_event      ON event_edit_sessions (event_id) WHERE released_at IS NULL;
CREATE INDEX idx_edit_sessions_user       ON event_edit_sessions (user_id, locked_at);
CREATE INDEX idx_edit_sessions_expires    ON event_edit_sessions (expires_at) WHERE released_at IS NULL;
CREATE INDEX idx_edit_sessions_event_user ON event_edit_sessions (event_id, user_id) WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION trg_event_edit_sessions_tenant_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event_tenant uuid;
  user_tenant  uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events         WHERE id = NEW.event_id;
  SELECT tenant_id INTO user_tenant  FROM tenant_members WHERE id = NEW.user_id;
  IF event_tenant IS NULL OR user_tenant IS NULL OR event_tenant <> user_tenant THEN
    RAISE EXCEPTION 'event_edit_sessions_tenant_mismatch: event tenant (%) <> user tenant (%)',
                    event_tenant, user_tenant
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_edit_sessions_tenant_match
BEFORE INSERT OR UPDATE OF event_id, user_id ON event_edit_sessions
FOR EACH ROW EXECUTE FUNCTION trg_event_edit_sessions_tenant_match();

ALTER TABLE event_edit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_edit_sessions FORCE ROW LEVEL SECURITY;
