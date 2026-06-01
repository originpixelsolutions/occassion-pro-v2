-- Phase 3 Unit 37: vendor_external_calendars (spec line 2029).
-- Vendor calendar sync. Four providers: google_calendar,
-- outlook, apple_calendar (read-only iCal subscription), and
-- raw ical_url for ad-hoc subscribe-by-URL.
--
-- OAuth providers (google_calendar, outlook) require the
-- access_token + refresh_token envelopes; the read-only
-- providers (apple_calendar, ical_url) must NOT have OAuth
-- tokens. This is enforced via two row-level CHECKs that gate
-- token columns on provider.
--
-- Token envelopes (access_token_encrypted, refresh_token_
-- encrypted) are paired with token_kms_key_id via a CHECK so
-- we always know which KMS key the ciphertext was wrapped
-- under (envelope-encryption discipline).
--
-- Partial UNIQUE on (vendor_account_id) WHERE is_primary=TRUE
-- AND NOT deleted: at most one primary calendar per vendor.
-- A vendor can flip which calendar is primary by clearing the
-- flag on one row and setting it on another.
--
-- status enum extended from spec's 3 to 4 (added 'error') so
-- the sync worker can mark failing calendars without
-- disconnecting them. status='error' requires last_sync_error
-- so silent failures can't slip in.

CREATE TABLE vendor_external_calendars (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id        uuid        NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  provider                 text        NOT NULL CHECK (provider IN ('google_calendar','outlook','apple_calendar','ical_url')),
  access_token_encrypted   bytea       CHECK (access_token_encrypted IS NULL OR octet_length(access_token_encrypted) BETWEEN 1 AND 8192),
  refresh_token_encrypted  bytea       CHECK (refresh_token_encrypted IS NULL OR octet_length(refresh_token_encrypted) BETWEEN 1 AND 8192),
  token_kms_key_id         text        CHECK (token_kms_key_id IS NULL OR length(token_kms_key_id) BETWEEN 1 AND 200),
  token_expires_at         timestamptz,
  ical_url                 text        CHECK (ical_url IS NULL OR (ical_url ~ '^(https?|webcal)://' AND length(ical_url) BETWEEN 1 AND 2048)),
  calendar_id              text        CHECK (calendar_id IS NULL OR length(calendar_id) BETWEEN 1 AND 256),
  display_name             text        CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 200),
  is_primary               boolean     NOT NULL DEFAULT FALSE,
  status                   text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected','error')),
  last_synced_at           timestamptz,
  last_sync_error          text        CHECK (last_sync_error IS NULL OR length(last_sync_error) <= 2000),
  sync_error_count         integer     NOT NULL DEFAULT 0 CHECK (sync_error_count >= 0),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  CHECK (provider <> 'ical_url' OR ical_url IS NOT NULL),
  CHECK (provider IN ('google_calendar','outlook') OR access_token_encrypted IS NULL),
  CHECK (provider IN ('google_calendar','outlook') OR refresh_token_encrypted IS NULL),
  CHECK ((access_token_encrypted IS NULL AND refresh_token_encrypted IS NULL) OR token_kms_key_id IS NOT NULL),
  CHECK (status <> 'error' OR last_sync_error IS NOT NULL)
);

CREATE UNIQUE INDEX uq_vendor_external_calendars_primary
  ON vendor_external_calendars (vendor_account_id) WHERE is_primary = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_vendor_calendars_vendor       ON vendor_external_calendars (vendor_account_id) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX idx_vendor_calendars_provider     ON vendor_external_calendars (provider) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_calendars_sync_due     ON vendor_external_calendars (last_synced_at) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX idx_vendor_calendars_token_expiry ON vendor_external_calendars (token_expires_at) WHERE token_expires_at IS NOT NULL AND status = 'active';

ALTER TABLE vendor_external_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_external_calendars FORCE ROW LEVEL SECURITY;
