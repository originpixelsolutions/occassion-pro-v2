-- Phase 9 Unit 57: outgoing_webhook_deliveries (spec 15.2 line 2958).
-- Per-attempt delivery record for outgoing webhooks. The
-- worker picks up rows where delivered_at IS NULL AND
-- failed_permanently = FALSE AND next_attempt_at <= now()
-- and POSTs with retry exponential backoff (1m, 5m, 30m,
-- 2h, 6h, 24h per spec).
--
-- tenant_id is denormalized alongside subscription_id so the
-- tenant-scoped dashboard queries don't need a join, and a
-- BEFORE INSERT trigger keeps them consistent with the
-- subscription's tenant.
--
-- event_id is auto-generated and unique per delivery - this
-- is what the subscriber sees in the X-OccasionPro-Event-Id
-- header and uses for client-side dedup.
--
-- Three coupling/ordering CHECKs prevent invalid combinations:
--   delivered_at requires attempted_at AND delivered_at >=
--     attempted_at
--   delivered_at and failed_permanently are mutually exclusive
--   failed_permanently=TRUE requires failed_permanently_at +
--     failed_permanently_reason
--   attempted_at requires attempt_count > 0
--   next_attempt_at >= created_at (no time travel)
--
-- attempt_count bounded 0-12. duration_ms bounded 0-120000
-- (2 min wall-clock cap). payload jsonb capped at 1 MiB and
-- must be an object. last_response_body and headers also
-- capped to keep the table queryable.
--
-- Partial UNIQUE (subscription_id, idempotency_key) prevents
-- the worker from enqueuing duplicate deliveries when the
-- same domain event fires twice.
--
-- Five-purpose index set: pending-work, per-subscription
-- history, per-tenant audit, per-event-type analytics, and
-- failed-permanently dashboard.

CREATE TABLE outgoing_webhook_deliveries (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id     uuid          NOT NULL REFERENCES outgoing_webhook_subscriptions(id) ON DELETE CASCADE,
  event_type          text          NOT NULL CHECK (length(trim(event_type)) BETWEEN 1 AND 100),
  event_id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  payload             jsonb         NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) < 1048576),
  signature           text          CHECK (signature IS NULL OR length(signature) BETWEEN 1 AND 256),
  attempt_count       integer       NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 12),
  next_attempt_at     timestamptz,
  attempted_at        timestamptz,
  delivered_at        timestamptz,
  last_status_code    integer       CHECK (last_status_code IS NULL OR (last_status_code >= 100 AND last_status_code <= 599)),
  last_response_body  text          CHECK (last_response_body IS NULL OR length(last_response_body) <= 16384),
  last_error          text          CHECK (last_error IS NULL OR length(last_error) <= 4000),
  last_response_headers jsonb       CHECK (last_response_headers IS NULL OR (jsonb_typeof(last_response_headers) = 'object' AND pg_column_size(last_response_headers) <= 8192)),
  duration_ms         integer       CHECK (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 120000)),
  failed_permanently  boolean       NOT NULL DEFAULT FALSE,
  failed_permanently_at timestamptz,
  failed_permanently_reason text    CHECK (failed_permanently_reason IS NULL OR length(failed_permanently_reason) <= 1000),
  idempotency_key     text          CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  trigger_resource_type text        CHECK (trigger_resource_type IS NULL OR length(trigger_resource_type) BETWEEN 1 AND 60),
  trigger_resource_id text          CHECK (trigger_resource_id IS NULL OR length(trigger_resource_id) BETWEEN 1 AND 200),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  CHECK ((delivered_at IS NULL) OR (attempted_at IS NOT NULL AND delivered_at >= attempted_at)),
  CHECK (delivered_at IS NULL OR failed_permanently = FALSE),
  CHECK (failed_permanently = FALSE OR (failed_permanently_at IS NOT NULL AND failed_permanently_reason IS NOT NULL)),
  CHECK (attempted_at IS NULL OR attempt_count > 0),
  CHECK (next_attempt_at IS NULL OR next_attempt_at >= created_at)
);

CREATE UNIQUE INDEX uq_webhook_deliveries_idempotency
  ON outgoing_webhook_deliveries (subscription_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_webhook_deliveries_pending      ON outgoing_webhook_deliveries (next_attempt_at) WHERE delivered_at IS NULL AND failed_permanently = FALSE;
CREATE INDEX idx_webhook_deliveries_subscription ON outgoing_webhook_deliveries (subscription_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_tenant       ON outgoing_webhook_deliveries (tenant_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_event_type   ON outgoing_webhook_deliveries (tenant_id, event_type, created_at DESC);
CREATE INDEX idx_webhook_deliveries_failed       ON outgoing_webhook_deliveries (tenant_id, failed_permanently_at DESC) WHERE failed_permanently = TRUE;
CREATE INDEX idx_webhook_deliveries_event_id     ON outgoing_webhook_deliveries (event_id);
CREATE INDEX idx_webhook_deliveries_trigger      ON outgoing_webhook_deliveries (trigger_resource_type, trigger_resource_id) WHERE trigger_resource_id IS NOT NULL;

CREATE OR REPLACE FUNCTION outgoing_webhook_deliveries_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE sub_tenant uuid;
BEGIN
  SELECT tenant_id INTO sub_tenant FROM outgoing_webhook_subscriptions WHERE id = NEW.subscription_id;
  IF sub_tenant IS NULL THEN
    RAISE EXCEPTION 'outgoing_webhook_deliveries.subscription_id % not found', NEW.subscription_id USING ERRCODE = '23503';
  END IF;
  IF sub_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'outgoing_webhook_deliveries.tenant_id % does not match subscription tenant %', NEW.tenant_id, sub_tenant USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_outgoing_webhook_deliveries_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, subscription_id ON outgoing_webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION outgoing_webhook_deliveries_check_tenant_match();

ALTER TABLE outgoing_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE outgoing_webhook_deliveries FORCE ROW LEVEL SECURITY;
