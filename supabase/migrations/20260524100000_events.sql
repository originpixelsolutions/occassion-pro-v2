-- Phase 3 Unit 1: events (spec Part 4).
-- Core event row. 8-state lifecycle:
--   planning -> live -> completed -> archived -> offloaded -> deleted_media -> deleted
--   (cancelled at any point)
-- Per-event timezone (IANA) + currency code. UNIQUE (tenant_id, code).
-- Also wires up Phase 1's deferred tenant_sheets_syncs.event_id FK.

CREATE TABLE events (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_type_id           uuid          NOT NULL REFERENCES event_types (id) ON DELETE RESTRICT,
  template_id             uuid          REFERENCES event_templates (id) ON DELETE SET NULL,
  code                    text          NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$'),
  name                    text          NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description             text          CHECK (description IS NULL OR length(description) <= 4000),
  banner_url              text          CHECK (banner_url IS NULL OR banner_url ~ '^https://'),
  venue_name              text          CHECK (venue_name IS NULL OR length(trim(venue_name)) BETWEEN 1 AND 200),
  venue_address           text          CHECK (venue_address IS NULL OR length(venue_address) <= 1000),
  venue_city              text          CHECK (venue_city IS NULL OR length(venue_city) BETWEEN 1 AND 120),
  venue_country           varchar(2)    CHECK (venue_country IS NULL OR venue_country ~ '^[A-Z]{2}$'),
  venue_lat               numeric(9,6)  CHECK (venue_lat IS NULL OR venue_lat BETWEEN -90 AND 90),
  venue_lng               numeric(9,6)  CHECK (venue_lng IS NULL OR venue_lng BETWEEN -180 AND 180),
  start_date              timestamptz   NOT NULL,
  end_date                timestamptz   NOT NULL,
  timezone                text          NOT NULL DEFAULT 'Asia/Kolkata' CHECK (length(trim(timezone)) BETWEEN 1 AND 80),
  currency_code           varchar(3)    NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  expected_guest_count    integer       CHECK (expected_guest_count IS NULL OR expected_guest_count >= 0),
  max_guest_count         integer       CHECK (max_guest_count IS NULL OR max_guest_count >= 0),
  primary_client_name     text          CHECK (primary_client_name IS NULL OR length(trim(primary_client_name)) BETWEEN 1 AND 200),
  status                  text          NOT NULL DEFAULT 'planning' CHECK (status IN (
                                          'planning','live','completed','cancelled','archived',
                                          'offloaded','deleted_media','deleted'
                                        )),
  completed_at            timestamptz,
  cancelled_at            timestamptz,
  cancelled_reason        text          CHECK (cancelled_reason IS NULL OR length(cancelled_reason) <= 2000),
  archived_at             timestamptz,
  archived_by             uuid          REFERENCES tenant_members (id) ON DELETE SET NULL,
  offloaded_at            timestamptz,
  offload_destination     text          CHECK (offload_destination IS NULL OR offload_destination IN ('google_drive','dropbox','onedrive','s3','r2','b2','wasabi')),
  offload_location_url    text          CHECK (offload_location_url IS NULL OR offload_location_url ~ '^https://'),
  offload_size_bytes      bigint        CHECK (offload_size_bytes IS NULL OR offload_size_bytes >= 0),
  guests_anonymized_at    timestamptz,
  created_by              uuid          REFERENCES tenant_members (id) ON DELETE SET NULL,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  CHECK (max_guest_count IS NULL OR expected_guest_count IS NULL OR expected_guest_count <= max_guest_count),
  CHECK ((venue_lat IS NULL) = (venue_lng IS NULL)),
  CHECK (status <> 'completed'     OR completed_at IS NOT NULL),
  CHECK (status <> 'cancelled'     OR (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL)),
  CHECK (status <> 'archived'      OR (archived_at IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (status <> 'offloaded'     OR (offloaded_at IS NOT NULL AND offload_destination IS NOT NULL AND offload_location_url IS NOT NULL AND archived_at IS NOT NULL)),
  CHECK (status <> 'deleted_media' OR offloaded_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_events_tenant_code ON events (tenant_id, code);

CREATE INDEX idx_events_tenant_status    ON events (tenant_id, status);
CREATE INDEX idx_events_tenant_start     ON events (tenant_id, start_date);
CREATE INDEX idx_events_event_type       ON events (event_type_id);
CREATE INDEX idx_events_template         ON events (template_id) WHERE template_id IS NOT NULL;
CREATE INDEX idx_events_active           ON events (tenant_id, start_date) WHERE status IN ('planning','live');
CREATE INDEX idx_events_completed_window ON events (completed_at) WHERE status = 'completed';
CREATE INDEX idx_events_offload_pending  ON events (archived_at) WHERE status = 'archived';

-- Resolve Phase 1 deferred FK.
ALTER TABLE tenant_sheets_syncs
  ADD CONSTRAINT tenant_sheets_syncs_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE;

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
