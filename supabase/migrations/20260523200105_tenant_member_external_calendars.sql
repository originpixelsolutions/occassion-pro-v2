-- Phase 2 Unit 22: tenant_member_external_calendars (spec 13.12 + 31.2).
-- Per-member Google/Outlook/Apple calendar OAuth. Powers "My Calendar"
-- overlay and bidirectional task push.

CREATE TABLE tenant_member_external_calendars (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id               uuid        NOT NULL REFERENCES tenant_members (id) ON DELETE CASCADE,
  provider                text        NOT NULL CHECK (provider IN ('google_calendar','outlook','apple_calendar')),
  access_token_encrypted  bytea       NOT NULL CHECK (octet_length(access_token_encrypted) > 0),
  refresh_token_encrypted bytea       CHECK (refresh_token_encrypted IS NULL OR octet_length(refresh_token_encrypted) > 0),
  token_expires_at        timestamptz,
  calendar_id             text        CHECK (calendar_id IS NULL OR length(trim(calendar_id)) > 0),
  sync_direction          text        NOT NULL DEFAULT 'two_way' CHECK (sync_direction IN ('read_only','two_way')),
  status                  text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected')),
  last_synced_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'expired' OR token_expires_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_tmec_active_per_member_provider
  ON tenant_member_external_calendars (member_id, provider)
  WHERE status = 'active';

CREATE INDEX idx_member_calendars    ON tenant_member_external_calendars (member_id) WHERE status = 'active';
CREATE INDEX idx_tmec_provider       ON tenant_member_external_calendars (provider);
CREATE INDEX idx_tmec_last_synced    ON tenant_member_external_calendars (last_synced_at) WHERE status = 'active';
CREATE INDEX idx_tmec_token_expiring ON tenant_member_external_calendars (token_expires_at) WHERE status = 'active' AND token_expires_at IS NOT NULL;

ALTER TABLE tenant_member_external_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_member_external_calendars FORCE ROW LEVEL SECURITY;
