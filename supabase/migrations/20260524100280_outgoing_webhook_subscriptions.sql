-- Phase 9 Unit 56: outgoing_webhook_subscriptions (spec 15.2 line 2942).
-- Growth+ tenant outgoing webhook config. HMAC signing,
-- event allowlist, IP allowlist for SSRF prevention.
--
-- Key hardening over spec:
-- - url MUST be https:// (spec says nothing; we require it)
-- - events array bounded 1-50 (must have at least one)
-- - signing_secret_encrypted is bytea ciphertext, paired with
--   signing_secret_kms_key_id (envelope-encryption discipline)
-- - signing_algorithm enum (hmac_sha256/sha512)
-- - is_paused separate from is_active (admin can pause without
--   deleting); paused_at + paused_reason coupled
-- - auto_disabled_at + auto_disabled_reason coupled and force
--   is_active=FALSE per spec's '10 consecutive failures auto-
--   disable' rule
-- - timeout_seconds bounded 1-60 (Cloudflare Queues consumer
--   constraint)
-- - max_retries bounded 0-12 (defaults 6 per spec)
-- - last_status_code 100-599
-- - allowed_ips array bounded 50
-- - custom_headers jsonb shape + 16 KiB cap
-- - total_failures <= total_deliveries (sanity)
-- - GIN index on events array for the worker's event-fanout
--   query
-- - Partial 'active and not paused' index for the dispatch
--   hot path
--
-- Cross-tenant trigger validates created_by member.

CREATE TABLE outgoing_webhook_subscriptions (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     text        CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 200),
  description              text        CHECK (description IS NULL OR length(description) <= 2000),
  url                      text        NOT NULL CHECK (url ~ '^https://' AND length(url) BETWEEN 1 AND 2048),
  events                   text[]      NOT NULL CHECK (array_length(events, 1) IS NOT NULL AND array_length(events, 1) >= 1 AND array_length(events, 1) <= 50),
  signing_secret_encrypted bytea       NOT NULL CHECK (octet_length(signing_secret_encrypted) BETWEEN 32 AND 4096),
  signing_secret_kms_key_id text       NOT NULL CHECK (length(signing_secret_kms_key_id) BETWEEN 1 AND 200),
  signing_algorithm        text        NOT NULL DEFAULT 'hmac_sha256' CHECK (signing_algorithm IN ('hmac_sha256','hmac_sha512')),
  is_active                boolean     NOT NULL DEFAULT TRUE,
  is_paused                boolean     NOT NULL DEFAULT FALSE,
  allowed_ips              inet[]      CHECK (allowed_ips IS NULL OR (array_length(allowed_ips, 1) IS NULL OR array_length(allowed_ips, 1) <= 50)),
  custom_headers           jsonb       CHECK (custom_headers IS NULL OR (jsonb_typeof(custom_headers) = 'object' AND pg_column_size(custom_headers) <= 16384)),
  timeout_seconds          integer     NOT NULL DEFAULT 10 CHECK (timeout_seconds >= 1 AND timeout_seconds <= 60),
  max_retries              integer     NOT NULL DEFAULT 6 CHECK (max_retries >= 0 AND max_retries <= 12),
  created_by               uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  last_delivered_at        timestamptz,
  last_status_code         integer     CHECK (last_status_code IS NULL OR (last_status_code >= 100 AND last_status_code <= 599)),
  last_attempt_at          timestamptz,
  consecutive_failures     integer     NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  total_deliveries         bigint      NOT NULL DEFAULT 0 CHECK (total_deliveries >= 0),
  total_failures           bigint      NOT NULL DEFAULT 0 CHECK (total_failures >= 0),
  auto_disabled_at         timestamptz,
  auto_disabled_reason     text        CHECK (auto_disabled_reason IS NULL OR length(auto_disabled_reason) <= 1000),
  paused_at                timestamptz,
  paused_reason            text        CHECK (paused_reason IS NULL OR length(paused_reason) <= 1000),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  CHECK (auto_disabled_at IS NULL OR (auto_disabled_reason IS NOT NULL AND is_active = FALSE)),
  CHECK (is_paused = FALSE OR (paused_at IS NOT NULL AND paused_reason IS NOT NULL)),
  CHECK (total_failures <= total_deliveries)
);

CREATE INDEX idx_webhook_subs_tenant   ON outgoing_webhook_subscriptions (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_webhook_subs_active   ON outgoing_webhook_subscriptions (tenant_id) WHERE is_active = TRUE AND is_paused = FALSE AND deleted_at IS NULL;
CREATE INDEX idx_webhook_subs_events   ON outgoing_webhook_subscriptions USING GIN (events) WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_webhook_subs_failing  ON outgoing_webhook_subscriptions (tenant_id, consecutive_failures DESC) WHERE consecutive_failures > 0 AND deleted_at IS NULL;
CREATE INDEX idx_webhook_subs_creator  ON outgoing_webhook_subscriptions (created_by) WHERE created_by IS NOT NULL;

CREATE OR REPLACE FUNCTION outgoing_webhook_subscriptions_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE creator_tenant uuid;
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'outgoing_webhook_subscriptions.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_outgoing_webhook_subscriptions_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, created_by ON outgoing_webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION outgoing_webhook_subscriptions_check_tenant_match();

ALTER TABLE outgoing_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outgoing_webhook_subscriptions FORCE ROW LEVEL SECURITY;
