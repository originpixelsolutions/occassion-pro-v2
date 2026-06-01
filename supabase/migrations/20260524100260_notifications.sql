-- Phase 8 Unit 52: notifications (spec 14.1 line 2834).
-- Unified notification record. Polymorphic recipient via
-- (recipient_type, recipient_id) - no FK because the type
-- can be any of six different parent tables.
--
-- recipient_type enum: tenant_member, client, vendor, guest,
-- speaker, super_admin. tenant_id is NULL only when the
-- recipient is a super_admin (platform-scoped); for every
-- other recipient_type tenant_id is required, enforced via:
--   CHECK (tenant_id IS NOT NULL OR recipient_type = 'super_admin')
--
-- priority enum: low/normal/high/critical (powers the
-- spec's quiet-hours bypass for critical).
--
-- is_read is coupled to read_at via two-way equality CHECK
-- so an unread row can't have a read_at and a read row must
-- have a read_at. expires_at defaults to created_at + 30 days
-- per spec (the PII-retention policy). The expires_at >
-- created_at CHECK prevents pathological pre-expired rows.
--
-- action_url permits http or https (spec doesn't gate this;
-- some integration links are http-only).
--
-- data jsonb capped at 16 KiB and must be an object.
--
-- Six partial indexes target the unread/priority/category/
-- super-admin/expiring lookup paths the notification worker
-- and bell-icon UI need.

CREATE TABLE notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        REFERENCES tenants(id) ON DELETE CASCADE,
  recipient_type text        NOT NULL CHECK (recipient_type IN ('tenant_member','client','vendor','guest','speaker','super_admin')),
  recipient_id   uuid        NOT NULL,
  category       text        NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 100),
  priority       text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  title          text        NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  body           text        NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  action_url     text        CHECK (action_url IS NULL OR (action_url ~ '^https?://' AND length(action_url) BETWEEN 1 AND 2048)),
  data           jsonb       CHECK (data IS NULL OR (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 16384)),
  is_read        boolean     NOT NULL DEFAULT FALSE,
  read_at        timestamptz,
  archived_at    timestamptz,
  dismissed_at   timestamptz,
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((is_read = TRUE) = (read_at IS NOT NULL)),
  CHECK (read_at IS NULL OR read_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at >= created_at),
  CHECK (dismissed_at IS NULL OR dismissed_at >= created_at),
  CHECK (expires_at > created_at),
  CHECK (tenant_id IS NOT NULL OR recipient_type = 'super_admin')
);

CREATE INDEX idx_notifications_recipient        ON notifications (recipient_type, recipient_id, is_read);
CREATE INDEX idx_notifications_tenant_priority  ON notifications (tenant_id, priority) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_tenant_unread    ON notifications (tenant_id, created_at DESC) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_expiring         ON notifications (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_notifications_category         ON notifications (tenant_id, category, created_at DESC);
CREATE INDEX idx_notifications_super_admin      ON notifications (recipient_id, is_read) WHERE recipient_type = 'super_admin';

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
