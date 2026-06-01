-- Phase 3 Unit 13: client_accounts (spec 7.1).
-- Cross-tenant client portal account. citext email globally UNIQUE -
-- one client identity per email even when they work with multiple
-- tenants. password_hash length-bounded for argon2id or bcrypt. MFA
-- coupling, lockout, suspension, soft-delete trio.

CREATE TABLE client_accounts (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                citext      NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  full_name            text        CHECK (full_name IS NULL OR length(trim(full_name)) BETWEEN 1 AND 200),
  phone                text        CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  password_hash        text        NOT NULL CHECK (length(password_hash) BETWEEN 50 AND 200),
  mfa_secret           bytea       CHECK (mfa_secret IS NULL OR octet_length(mfa_secret) > 0),
  mfa_enabled          boolean     NOT NULL DEFAULT FALSE,
  recovery_email       citext      CHECK (recovery_email IS NULL OR (recovery_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(recovery_email) <= 254)),
  recovery_phone       text        CHECK (recovery_phone IS NULL OR recovery_phone ~ '^\+[1-9][0-9]{6,14}$'),
  failed_login_count   integer     NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until         timestamptz,
  last_login_at        timestamptz,
  last_login_ip        inet,
  suspended_at         timestamptz,
  suspended_reason     text        CHECK (suspended_reason IS NULL OR length(suspended_reason) <= 2000),
  email_verified_at    timestamptz,
  deleted_at           timestamptz,
  purge_after          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (mfa_enabled = FALSE OR mfa_secret IS NOT NULL),
  CHECK (suspended_at IS NULL OR suspended_reason IS NOT NULL),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL),
  CHECK (locked_until IS NULL OR locked_until > created_at)
);

CREATE INDEX idx_client_accounts_phone      ON client_accounts (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_client_accounts_locked     ON client_accounts (locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX idx_client_accounts_suspended  ON client_accounts (suspended_at) WHERE suspended_at IS NOT NULL;
CREATE INDEX idx_client_accounts_unverified ON client_accounts (created_at) WHERE email_verified_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_client_accounts_purge_due  ON client_accounts (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

ALTER TABLE client_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_accounts FORCE ROW LEVEL SECURITY;
