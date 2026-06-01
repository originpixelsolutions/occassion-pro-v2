-- Phase 9 Unit 58: incoming_webhook_log (spec 15.1 line 2924).
-- Append-only log of incoming gateway webhooks. bigserial PK
-- chosen over uuid because:
--   - high-volume audit table (every gateway webhook)
--   - sequential physical locality matches the receive-order
--     query pattern
--   - the (source, external_id) UNIQUE is the spec-mandated
--     24-hour idempotency cache
--
-- source enum extended from spec's free-text to 14 known
-- gateways: razorpay, stripe, cashfree, paytm (payments);
-- meta_whatsapp (messaging); sendgrid, twilio (email/SMS);
-- docusign, signwell (e-sig); workos (SSO); google_calendar,
-- outlook (calendar); zapier; generic_webhook (catch-all).
--
-- payload jsonb accepts EITHER object or array (Stripe sends
-- objects, some gateways batch as arrays), capped at 1 MiB.
-- headers separately kept at 16 KiB.
--
-- Six-state machine: received -> processing -> processed |
-- failed | rejected | duplicate. Per-state prereq CHECKs.
--
-- Partial-immutable trigger: the canonical audit fields
-- (source, external_id, payload, headers, signature_received,
-- source_ip, received_at) are frozen post-insert. Workflow
-- fields (status, processed_at, error, retry_count) can be
-- updated as processing progresses.

CREATE TABLE incoming_webhook_log (
  id                bigserial   PRIMARY KEY,
  source            text        NOT NULL CHECK (source IN ('razorpay','stripe','cashfree','paytm','meta_whatsapp','sendgrid','twilio','docusign','signwell','workos','google_calendar','outlook','zapier','generic_webhook')),
  external_id       text        CHECK (external_id IS NULL OR length(external_id) BETWEEN 1 AND 256),
  event_type        text        CHECK (event_type IS NULL OR length(event_type) BETWEEN 1 AND 100),
  payload           jsonb       NOT NULL CHECK (jsonb_typeof(payload) IN ('object','array') AND pg_column_size(payload) < 1048576),
  headers           jsonb       CHECK (headers IS NULL OR (jsonb_typeof(headers) = 'object' AND pg_column_size(headers) <= 16384)),
  signature_valid   boolean,
  signature_algorithm text      CHECK (signature_algorithm IS NULL OR signature_algorithm IN ('hmac_sha256','hmac_sha512','rsa_sha256','ed25519')),
  signature_received text       CHECK (signature_received IS NULL OR length(signature_received) BETWEEN 1 AND 1024),
  source_ip         inet,
  user_agent        text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  status            text        NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','failed','rejected','duplicate')),
  processed_at      timestamptz,
  processing_started_at timestamptz,
  processing_duration_ms integer CHECK (processing_duration_ms IS NULL OR (processing_duration_ms >= 0 AND processing_duration_ms <= 300000)),
  error             text        CHECK (error IS NULL OR length(error) <= 4000),
  retry_count       integer     NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 20),
  related_resource_type text    CHECK (related_resource_type IS NULL OR length(related_resource_type) BETWEEN 1 AND 60),
  related_resource_id   text    CHECK (related_resource_id IS NULL OR length(related_resource_id) BETWEEN 1 AND 200),
  received_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id),
  CHECK (status <> 'processed'  OR processed_at IS NOT NULL),
  CHECK (status <> 'failed'     OR error IS NOT NULL),
  CHECK (status <> 'duplicate'  OR external_id IS NOT NULL),
  CHECK (status <> 'processing' OR processing_started_at IS NOT NULL),
  CHECK (processed_at IS NULL OR processed_at >= received_at),
  CHECK (processing_started_at IS NULL OR processing_started_at >= received_at)
);

CREATE INDEX idx_incoming_webhook_received     ON incoming_webhook_log (received_at);
CREATE INDEX idx_incoming_webhook_unprocessed  ON incoming_webhook_log (source, received_at) WHERE processed_at IS NULL AND status <> 'rejected' AND status <> 'duplicate';
CREATE INDEX idx_incoming_webhook_status       ON incoming_webhook_log (status, received_at DESC);
CREATE INDEX idx_incoming_webhook_source_type  ON incoming_webhook_log (source, event_type, received_at DESC);
CREATE INDEX idx_incoming_webhook_invalid_sig  ON incoming_webhook_log (source, received_at DESC) WHERE signature_valid = FALSE;
CREATE INDEX idx_incoming_webhook_external     ON incoming_webhook_log (source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_incoming_webhook_related      ON incoming_webhook_log (related_resource_type, related_resource_id) WHERE related_resource_id IS NOT NULL;

CREATE OR REPLACE FUNCTION incoming_webhook_log_block_payload_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.headers IS DISTINCT FROM OLD.headers
     OR NEW.signature_received IS DISTINCT FROM OLD.signature_received
     OR NEW.source_ip IS DISTINCT FROM OLD.source_ip
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'incoming_webhook_log canonical fields are immutable (source, external_id, payload, headers, signature_received, source_ip, received_at)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_incoming_webhook_log_immutable
  BEFORE UPDATE ON incoming_webhook_log
  FOR EACH ROW EXECUTE FUNCTION incoming_webhook_log_block_payload_update();

ALTER TABLE incoming_webhook_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_webhook_log FORCE ROW LEVEL SECURITY;
