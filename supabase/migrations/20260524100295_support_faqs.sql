-- Phase 10 Unit 59: support_faqs (spec 16 line 2992).
-- Platform-wide FAQ knowledge base. Powers the bot-handler
-- that fields incoming support_tickets before escalation.
--
-- Hardening: 18-value category enum (billing, events, guests,
-- vendors, clients, speakers, runsheet, floor_plan, inventory,
-- communications, payments, exports, onboarding, account,
-- security, integrations, technical, other). 7-value audience
-- enum + 4-value visibility enum so the bot can filter by
-- caller identity.
--
-- tags text[] capped at 30. related_help_keys text[] cap 20.
-- language_code matches BCP-47-ish. source_url HTTPS only.
--
-- Telemetry: view_count, helpful_count, unhelpful_count,
-- bot_match_count - all bigint/integer with >= 0 invariants.
-- Powers the analytics dashboard for FAQ effectiveness.
--
-- Three coupling CHECKs:
--   is_active and retired_at mutually exclusive
--   retired_at requires retired_reason
--   last_reviewed_at <-> last_reviewed_by both or neither
--
-- Author/reviewer references super_admins (platform-managed
-- content). Soft-delete trio + retired distinction lets
-- editors archive without losing analytics history.

CREATE TABLE support_faqs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_pattern text        NOT NULL CHECK (length(trim(question_pattern)) BETWEEN 1 AND 1000),
  answer           text        NOT NULL CHECK (length(trim(answer)) BETWEEN 1 AND 16384),
  category         text        CHECK (category IS NULL OR category IN ('billing','events','guests','vendors','clients','speakers','runsheet','floor_plan','inventory','communications','payments','exports','onboarding','account','security','integrations','technical','other')),
  tags             text[]      CHECK (tags IS NULL OR (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 30)),
  language_code    text        NOT NULL DEFAULT 'en' CHECK (language_code ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  audience         text        NOT NULL DEFAULT 'all' CHECK (audience IN ('all','tenant_member','client','vendor','guest','speaker','super_admin')),
  visibility       text        NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','authenticated','tenant_only','super_admin_only')),
  related_help_keys text[]     CHECK (related_help_keys IS NULL OR (array_length(related_help_keys, 1) IS NULL OR array_length(related_help_keys, 1) <= 20)),
  sort_order       integer     NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active        boolean     NOT NULL DEFAULT TRUE,
  view_count       bigint      NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  helpful_count    integer     NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  unhelpful_count  integer     NOT NULL DEFAULT 0 CHECK (unhelpful_count >= 0),
  bot_match_count  bigint      NOT NULL DEFAULT 0 CHECK (bot_match_count >= 0),
  source_url       text        CHECK (source_url IS NULL OR (source_url ~ '^https://' AND length(source_url) BETWEEN 1 AND 2048)),
  author_id        uuid        REFERENCES super_admins(id) ON DELETE SET NULL,
  last_reviewed_at timestamptz,
  last_reviewed_by uuid        REFERENCES super_admins(id) ON DELETE SET NULL,
  retired_at       timestamptz,
  retired_reason   text        CHECK (retired_reason IS NULL OR length(retired_reason) <= 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CHECK (NOT is_active OR retired_at IS NULL),
  CHECK (retired_at IS NULL OR retired_reason IS NOT NULL),
  CHECK ((last_reviewed_at IS NULL) = (last_reviewed_by IS NULL))
);

CREATE INDEX idx_support_faqs_active     ON support_faqs (category, sort_order) WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_support_faqs_category   ON support_faqs (category) WHERE category IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_support_faqs_language   ON support_faqs (language_code, is_active);
CREATE INDEX idx_support_faqs_audience   ON support_faqs (audience, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_support_faqs_tags       ON support_faqs USING GIN (tags) WHERE tags IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_support_faqs_review_due ON support_faqs (last_reviewed_at) WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_support_faqs_popular    ON support_faqs (view_count DESC, helpful_count DESC) WHERE is_active = TRUE AND deleted_at IS NULL;

ALTER TABLE support_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_faqs FORCE ROW LEVEL SECURITY;
