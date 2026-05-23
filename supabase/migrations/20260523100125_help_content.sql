-- 0018_help_content | Phase 1 | spec 30.5
CREATE TABLE help_content (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  context_key     text        UNIQUE NOT NULL CHECK (length(trim(context_key)) > 0),
  title           text        NOT NULL CHECK (length(trim(title)) > 0),
  body_markdown   text,
  video_url       text,
  learn_more_url  text,
  locale          text        NOT NULL DEFAULT 'en' CHECK (locale ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  is_active       boolean     NOT NULL DEFAULT TRUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_help_context ON help_content (context_key, locale) WHERE is_active = TRUE;
ALTER TABLE help_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_content FORCE ROW LEVEL SECURITY;
