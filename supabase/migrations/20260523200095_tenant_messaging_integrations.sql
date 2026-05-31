-- Phase 2 Unit 20: tenant_messaging_integrations (spec 31.6).
-- Slack / MS Teams webhook subscriptions. Webhook URL stored as
-- libsodium-sealed bytea (DB never sees plaintext). subscribed_events
-- is a non-empty array of event-type codes.

CREATE TABLE tenant_messaging_integrations (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  provider              text        NOT NULL CHECK (provider IN ('slack','microsoft_teams')),
  webhook_url_encrypted bytea       NOT NULL CHECK (octet_length(webhook_url_encrypted) > 0),
  channel_name          text        CHECK (channel_name IS NULL OR length(trim(channel_name)) BETWEEN 1 AND 120),
  workspace_name        text        CHECK (workspace_name IS NULL OR length(trim(workspace_name)) BETWEEN 1 AND 120),
  subscribed_events     text[]      NOT NULL CHECK (cardinality(subscribed_events) >= 1),
  per_event_routing     jsonb       CHECK (per_event_routing IS NULL OR jsonb_typeof(per_event_routing) = 'object'),
  configured_by         uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  status                text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','error','disconnected')),
  last_error            text        CHECK (last_error IS NULL OR length(last_error) <= 2000),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'error' OR last_error IS NOT NULL)
);

CREATE INDEX idx_tmi_tenant_active ON tenant_messaging_integrations (tenant_id) WHERE status = 'active';
CREATE INDEX idx_tmi_provider      ON tenant_messaging_integrations (tenant_id, provider);
CREATE INDEX idx_tmi_configured_by ON tenant_messaging_integrations (configured_by) WHERE configured_by IS NOT NULL;

ALTER TABLE tenant_messaging_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_messaging_integrations FORCE ROW LEVEL SECURITY;
