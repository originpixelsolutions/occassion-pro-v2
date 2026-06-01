-- Phase 8 Unit 53: notification_deliveries (spec 14.1 line 2851).
-- Per-channel delivery attempts. Each row records ONE attempt
-- through ONE channel for ONE notification - the notification
-- worker fans out to multiple rows when a recipient has
-- multiple channels enabled, and each row tracks its own
-- gateway lifecycle.
--
-- Eight-state machine:
--   queued -> sending -> sent -> delivered -> read
--                              -> failed
--                              -> bounced
--                              -> suppressed
--
-- Per-state prereq CHECKs:
--   sending   : attempted_at NOT NULL
--   sent      : sent_at NOT NULL
--   delivered : sent_at AND delivered_at NOT NULL
--   read      : delivered_at AND read_at NOT NULL
--   failed    : failed_at AND error_message NOT NULL
--   bounced   : bounced_at AND error_message NOT NULL
--
-- Time ordering CHECKs prevent travel-time-back issues:
--   sent_at >= queued_at
--   delivered_at >= sent_at
--   read_at >= delivered_at
--
-- attempts bounded 0-20 (reasonable retry ceiling).
-- cost_micro_units paired with cost_currency via two-way
-- coupling. Provider message ID is partial-UNIQUE per channel
-- so webhook delivery updates can idempotently upsert.
--
-- Partial 'queued' index on status for fast pending-work
-- queries; failed and channel/status indexes for analytics.

CREATE TABLE notification_deliveries (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id     uuid        NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel             text        NOT NULL CHECK (channel IN ('in_app','email','push','sms','whatsapp','slack','teams')),
  provider            text        CHECK (provider IS NULL OR length(provider) BETWEEN 1 AND 100),
  recipient_address   text        CHECK (recipient_address IS NULL OR length(recipient_address) BETWEEN 1 AND 500),
  template_name       text        CHECK (template_name IS NULL OR length(template_name) BETWEEN 1 AND 200),
  status              text        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','read','failed','bounced','suppressed')),
  attempts            integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 20),
  queued_at           timestamptz NOT NULL DEFAULT now(),
  attempted_at        timestamptz,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  bounced_at          timestamptz,
  error_code          text        CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
  error_message       text        CHECK (error_message IS NULL OR length(error_message) <= 4000),
  provider_message_id text        CHECK (provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 256),
  cost_micro_units    bigint      CHECK (cost_micro_units IS NULL OR cost_micro_units >= 0),
  cost_currency       varchar(3)  CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$'),
  metadata            jsonb       CHECK (metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 16384)),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'sending'    OR attempted_at IS NOT NULL),
  CHECK (status <> 'sent'       OR sent_at IS NOT NULL),
  CHECK (status <> 'delivered'  OR (sent_at IS NOT NULL AND delivered_at IS NOT NULL)),
  CHECK (status <> 'read'       OR (delivered_at IS NOT NULL AND read_at IS NOT NULL)),
  CHECK (status <> 'failed'     OR (failed_at IS NOT NULL AND error_message IS NOT NULL)),
  CHECK (status <> 'bounced'    OR (bounced_at IS NOT NULL AND error_message IS NOT NULL)),
  CHECK ((cost_micro_units IS NULL) = (cost_currency IS NULL)),
  CHECK (sent_at IS NULL OR sent_at >= queued_at),
  CHECK (delivered_at IS NULL OR (sent_at IS NOT NULL AND delivered_at >= sent_at)),
  CHECK (read_at IS NULL OR (delivered_at IS NOT NULL AND read_at >= delivered_at))
);

CREATE UNIQUE INDEX uq_notification_deliveries_provider
  ON notification_deliveries (channel, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE INDEX idx_notification_deliveries_notification ON notification_deliveries (notification_id);
CREATE INDEX idx_notification_deliveries_status       ON notification_deliveries (status) WHERE status = 'queued';
CREATE INDEX idx_notification_deliveries_pending      ON notification_deliveries (queued_at) WHERE status IN ('queued','sending');
CREATE INDEX idx_notification_deliveries_failed       ON notification_deliveries (channel, failed_at DESC) WHERE status = 'failed';
CREATE INDEX idx_notification_deliveries_channel      ON notification_deliveries (channel, status, queued_at DESC);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
