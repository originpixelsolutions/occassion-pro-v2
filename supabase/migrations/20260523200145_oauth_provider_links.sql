-- Phase 2 Unit 30: oauth_provider_links (spec 19.1.2).
-- Social-login linkage. UNIQUE (provider, provider_user_id) blocks
-- hijacking. UNIQUE (auth_user_id, provider) prevents one user linking
-- two accounts at the same provider.

CREATE TABLE oauth_provider_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id     uuid        NOT NULL,
  provider         text        NOT NULL CHECK (provider IN ('google','microsoft','apple','linkedin')),
  provider_user_id text        NOT NULL CHECK (length(trim(provider_user_id)) BETWEEN 1 AND 256),
  provider_email   citext      CHECK (provider_email IS NULL OR (provider_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(provider_email) <= 254)),
  linked_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  UNIQUE (provider, provider_user_id),
  CHECK (last_used_at IS NULL OR last_used_at >= linked_at)
);

CREATE INDEX idx_oauth_user           ON oauth_provider_links (auth_user_id);
CREATE INDEX idx_oauth_provider_email ON oauth_provider_links (provider, provider_email) WHERE provider_email IS NOT NULL;
CREATE INDEX idx_oauth_recent         ON oauth_provider_links (auth_user_id, last_used_at) WHERE last_used_at IS NOT NULL;

CREATE UNIQUE INDEX uq_oauth_user_provider
  ON oauth_provider_links (auth_user_id, provider);

ALTER TABLE oauth_provider_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_provider_links FORCE ROW LEVEL SECURITY;
