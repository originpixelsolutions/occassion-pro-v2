-- Phase 8 Unit 54: notification_preferences (spec 14.1 line 2864).
-- Per-user per-category channel toggles + quiet hours.
-- Composite PK (user_id, user_type, category) per spec.
--
-- user_type enum (6 values) matches notifications.recipient_type:
-- tenant_member, client, vendor, guest, speaker, super_admin.
-- tenant_id is NULL only for super_admin (platform-scoped
-- preferences); for everyone else tenant_id is required:
--   CHECK (tenant_id IS NOT NULL OR user_type = 'super_admin')
--
-- Seven channel boolean toggles match notification_deliveries'
-- channel enum. Defaults: in_app/email/push = TRUE (always-on
-- channels), sms/whatsapp/slack/teams = FALSE (opt-in
-- channels per spec).
--
-- digest_frequency enum: immediate / hourly / daily / weekly.
-- quiet_hours_start and quiet_hours_end are coupled via
-- (NULL = NULL) CHECK so both or neither. bypass_quiet_for_
-- critical defaults TRUE per spec's 'critical ignores quiet
-- hours' dispatch rule.
--
-- quiet_hours_timezone is a free-text IANA tz name field;
-- we cap at 60 chars (longest IANA name is 'America/Indiana/
-- Indianapolis' at 30; 60 is generous headroom).

CREATE TABLE notification_preferences (
  user_id            uuid        NOT NULL,
  user_type          text        NOT NULL CHECK (user_type IN ('tenant_member','client','vendor','guest','speaker','super_admin')),
  category           text        NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 100),
  tenant_id          uuid        REFERENCES tenants(id) ON DELETE CASCADE,
  in_app_enabled     boolean     NOT NULL DEFAULT TRUE,
  email_enabled      boolean     NOT NULL DEFAULT TRUE,
  push_enabled       boolean     NOT NULL DEFAULT TRUE,
  sms_enabled        boolean     NOT NULL DEFAULT FALSE,
  whatsapp_enabled   boolean     NOT NULL DEFAULT FALSE,
  slack_enabled      boolean     NOT NULL DEFAULT FALSE,
  teams_enabled      boolean     NOT NULL DEFAULT FALSE,
  digest_frequency   text        CHECK (digest_frequency IS NULL OR digest_frequency IN ('immediate','hourly','daily','weekly')),
  quiet_hours_start  time,
  quiet_hours_end    time,
  quiet_hours_timezone text      CHECK (quiet_hours_timezone IS NULL OR length(quiet_hours_timezone) BETWEEN 1 AND 60),
  bypass_quiet_for_critical boolean NOT NULL DEFAULT TRUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, user_type, category),
  CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL)),
  CHECK (tenant_id IS NOT NULL OR user_type = 'super_admin')
);

CREATE INDEX idx_notif_prefs_user     ON notification_preferences (user_id, user_type);
CREATE INDEX idx_notif_prefs_tenant   ON notification_preferences (tenant_id, user_type) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_notif_prefs_category ON notification_preferences (category, user_type);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
