-- Phase 2 Unit 31: magic_links (spec 19.1.3).
-- 15-min passwordless login tokens. token_hash = sha256(token). Single-use:
-- consumed_at + consumed_ip travel as a pair. One open link per (user,
-- user_type) at a time; consumed rows persist for audit.

CREATE TABLE magic_links (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL,
  user_type          text        NOT NULL CHECK (user_type IN ('tenant_member','super_admin','client','vendor','speaker')),
  email              citext      NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  token_hash         text        NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  ip_address         inet,
  user_agent         text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  device_fingerprint text        CHECK (device_fingerprint IS NULL OR length(trim(device_fingerprint)) BETWEEN 8 AND 256),
  expires_at         timestamptz NOT NULL,
  consumed_at        timestamptz,
  consumed_ip        inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + INTERVAL '1 hour'),
  CHECK ((consumed_at IS NULL) = (consumed_ip IS NULL)),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX idx_magic_links_user   ON magic_links (user_id, user_type, consumed_at);
CREATE INDEX idx_magic_links_email  ON magic_links (email, consumed_at);
CREATE INDEX idx_magic_links_expiry ON magic_links (expires_at) WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX uq_magic_links_open_per_user
  ON magic_links (user_id, user_type) WHERE consumed_at IS NULL;

ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_links FORCE ROW LEVEL SECURITY;
