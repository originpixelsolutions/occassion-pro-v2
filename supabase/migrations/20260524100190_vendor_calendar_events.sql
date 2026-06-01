-- Phase 3 Unit 38: vendor_calendar_events (spec line 2045).
-- External calendar events mirrored into OccasionPro by the
-- VendorCalendarSyncWorker. Powers the conflict-detection
-- warning when a tenant tries to assign a vendor for a date
-- they're already booked.
--
-- Carries vendor_account_id denormalized (in addition to
-- vendor_calendar_id) so the conflict-check query can filter
-- by vendor_account_id + time range without a join through
-- vendor_external_calendars. A tenant-match trigger asserts
-- the two are consistent.
--
-- status enum from spec extended (default 'confirmed') so the
-- worker can ingest cancelled events (so when the upstream
-- cancels a meeting, the conflict warning disappears).
-- recurrence_rule (RRULE text from RFC 5545) capped at 1000
-- chars. external_url HTTPS only.
--
-- all_day requires both timestamps to be aligned to a day
-- boundary - prevents partial-day all_day events that some
-- providers misreport.
--
-- UNIQUE (vendor_calendar_id, external_event_id) per spec so
-- the worker can UPSERT on the natural key without dupes.

CREATE TABLE vendor_calendar_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_calendar_id  uuid        NOT NULL REFERENCES vendor_external_calendars(id) ON DELETE CASCADE,
  vendor_account_id   uuid        NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  external_event_id   text        NOT NULL CHECK (length(external_event_id) BETWEEN 1 AND 512),
  title               text        CHECK (title IS NULL OR length(title) BETWEEN 1 AND 500),
  location            text        CHECK (location IS NULL OR length(location) <= 500),
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  all_day             boolean     NOT NULL DEFAULT FALSE,
  busy                boolean     NOT NULL DEFAULT TRUE,
  status              text        NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','tentative','cancelled')),
  recurrence_rule     text        CHECK (recurrence_rule IS NULL OR length(recurrence_rule) <= 1000),
  external_url        text        CHECK (external_url IS NULL OR (external_url ~ '^https://' AND length(external_url) BETWEEN 1 AND 2048)),
  synced_at           timestamptz NOT NULL DEFAULT now(),
  external_etag       text        CHECK (external_etag IS NULL OR length(external_etag) <= 200),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at),
  CHECK (NOT all_day OR (date_trunc('day', starts_at) = starts_at AND date_trunc('day', ends_at) = ends_at))
);

CREATE UNIQUE INDEX uq_vendor_calendar_events_external
  ON vendor_calendar_events (vendor_calendar_id, external_event_id);

CREATE INDEX idx_vendor_cal_events_time     ON vendor_calendar_events (vendor_calendar_id, starts_at, ends_at);
CREATE INDEX idx_vendor_cal_events_busy     ON vendor_calendar_events (vendor_account_id, starts_at, ends_at) WHERE busy = TRUE AND status <> 'cancelled';
CREATE INDEX idx_vendor_cal_events_synced   ON vendor_calendar_events (vendor_calendar_id, synced_at DESC);
CREATE INDEX idx_vendor_cal_events_status   ON vendor_calendar_events (vendor_calendar_id, status);

CREATE OR REPLACE FUNCTION vendor_calendar_events_check_calendar_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cal_vendor uuid;
BEGIN
  SELECT vendor_account_id INTO cal_vendor FROM vendor_external_calendars WHERE id = NEW.vendor_calendar_id;
  IF cal_vendor IS NULL THEN
    RAISE EXCEPTION 'vendor_calendar_events.vendor_calendar_id % not found', NEW.vendor_calendar_id USING ERRCODE = '23503';
  END IF;
  IF cal_vendor <> NEW.vendor_account_id THEN
    RAISE EXCEPTION 'vendor_calendar_events.vendor_account_id % does not match calendar vendor %', NEW.vendor_account_id, cal_vendor USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_calendar_events_calendar_match
  BEFORE INSERT OR UPDATE OF vendor_calendar_id, vendor_account_id ON vendor_calendar_events
  FOR EACH ROW EXECUTE FUNCTION vendor_calendar_events_check_calendar_match();

ALTER TABLE vendor_calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_calendar_events FORCE ROW LEVEL SECURITY;
