-- Phase 3 Unit 15: speaker_accounts (spec 7.3).
-- Cross-tenant speaker portal. Magic-link-default auth so
-- password_hash is nullable. MFA requires both password_hash and
-- mfa_secret. Speaker-specific: bio (5k cap), photo_url HTTPS,
-- socials jsonb object (16 KiB cap), expertise_tags text[] (30
-- cap, GIN). last_magic_link_at for 15-min token / 30-day session.

CREATE TABLE speaker_accounts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext      NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  full_name           text        CHECK (full_name IS NULL OR length(trim(full_name)) BETWEEN 1 AND 200),
  phone               text        CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  password_hash       text        CHECK (password_hash IS NULL OR length(password_hash) BETWEEN 50 AND 200),
  mfa_secret          bytea       CHECK (mfa_secret IS NULL OR octet_length(mfa_secret) > 0),
  mfa_enabled         boolean     NOT NULL DEFAULT FALSE,
  bio                 text        CHECK (bio IS NULL OR length(bio) <= 5000),
  photo_url           text        CHECK (photo_url IS NULL OR (photo_url ~ '^https://' AND length(photo_url) BETWEEN 1 AND 2048)),
  socials             jsonb       CHECK (socials IS NULL OR (jsonb_typeof(socials) = 'object' AND pg_column_size(socials) <= 16384)),
  expertise_tags      text[]      CHECK (expertise_tags IS NULL OR (array_length(expertise_tags, 1) IS NULL OR array_length(expertise_tags, 1) <= 30)),
  failed_login_count  integer     NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until        timestamptz,
  last_login_at       timestamptz,
  last_login_ip       inet,
  last_magic_link_at  timestamptz,
  suspended_at        timestamptz,
  suspended_reason    text        CHECK (suspended_reason IS NULL OR length(suspended_reason) <= 2000),
  email_verified_at   timestamptz,
  deleted_at          timestamptz,
  purge_after         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (mfa_enabled = FALSE OR mfa_secret IS NOT NULL),
  CHECK (mfa_enabled = FALSE OR password_hash IS NOT NULL),
  CHECK (suspended_at IS NULL OR suspended_reason IS NOT NULL),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL),
  CHECK (locked_until IS NULL OR locked_until > created_at)
);

CREATE INDEX idx_speaker_accounts_phone        ON speaker_accounts (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_speaker_accounts_locked       ON speaker_accounts (locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX idx_speaker_accounts_suspended    ON speaker_accounts (suspended_at) WHERE suspended_at IS NOT NULL;
CREATE INDEX idx_speaker_accounts_unverified   ON speaker_accounts (created_at) WHERE email_verified_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_speaker_accounts_purge_due    ON speaker_accounts (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;
CREATE INDEX idx_speaker_accounts_full_name    ON speaker_accounts (lower(full_name)) WHERE full_name IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_speaker_accounts_expertise    ON speaker_accounts USING GIN (expertise_tags) WHERE expertise_tags IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE speaker_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE speaker_accounts FORCE ROW LEVEL SECURITY;
