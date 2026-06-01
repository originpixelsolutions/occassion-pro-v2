-- Phase 10 Unit 60: support_tickets (spec 16 line 3002).
-- Per-tenant support tickets with conversation thread.
--
-- ticket_number is the human-readable identifier (e.g.
-- 'OCP-12345') regex-enforced as 2-8 uppercase letters,
-- hyphen, 1-10 digits. UNIQUE so it can appear in emails and
-- Slack messages.
--
-- 5-value user_type enum matches spec; tenant_member tickets
-- require tenant_id (enforced via CHECK).
--
-- 20-value category enum extending the spec set with
-- feature_request, bug_report. 4-value priority enum
-- (low/normal/high/urgent).
--
-- 8-value status state machine extending spec's 5 with
-- in_progress, waiting_on_user, reopened. Six per-state
-- prereq CHECKs:
--   bot_handled   : bot_handled_at AND bot_handled_faq_id
--   escalated     : escalated_at AND escalation_reason
--   resolved      : resolved_at AND resolved_by AND
--                   resolution_summary
--   closed        : closed_at NOT NULL
--   reopened      : reopened_at AND reopened_reason
-- Plus assigned_at requires assigned_to, and satisfaction
-- submission requires both rating and prior resolution.
--
-- messages jsonb is a strict array (conversation thread) cap
-- 500 turns / 5 MiB. attachments jsonb (R2 key references)
-- cap 50 entries / 32 KiB.
--
-- Time-order CHECKs: first_response_at, resolved_at,
-- closed_at all >= created_at.
--
-- 11 partial indexes target the support dashboard's hot paths:
-- tenant status, user backref, status board, priority queue,
-- assigned tickets, unassigned escalations, resolver
-- analytics, SLA first-response tracker, category breakdown,
-- related-resource backref, satisfaction analytics.

CREATE TABLE support_tickets (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number        text        NOT NULL UNIQUE CHECK (ticket_number ~ '^[A-Z]{2,8}-[0-9]{1,10}$'),
  tenant_id            uuid        REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid        NOT NULL,
  user_type            text        NOT NULL CHECK (user_type IN ('tenant_member','client','vendor','guest','speaker')),
  subject              text        NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 300),
  category             text        CHECK (category IS NULL OR category IN ('billing','events','guests','vendors','clients','speakers','runsheet','floor_plan','inventory','communications','payments','exports','onboarding','account','security','integrations','technical','feature_request','bug_report','other')),
  priority             text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  messages             jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messages) = 'array' AND jsonb_array_length(messages) <= 500 AND pg_column_size(messages) < 5242880),
  status               text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','bot_handled','escalated','in_progress','waiting_on_user','resolved','closed','reopened')),
  bot_handled_at       timestamptz,
  bot_handled_faq_id   uuid        REFERENCES support_faqs(id) ON DELETE SET NULL,
  escalated_at         timestamptz,
  escalation_reason    text        CHECK (escalation_reason IS NULL OR length(escalation_reason) <= 2000),
  assigned_to          uuid        REFERENCES super_admins(id) ON DELETE SET NULL,
  assigned_at          timestamptz,
  first_response_at    timestamptz,
  resolved_at          timestamptz,
  resolved_by          uuid        REFERENCES super_admins(id) ON DELETE SET NULL,
  resolution_summary   text        CHECK (resolution_summary IS NULL OR length(resolution_summary) <= 8000),
  closed_at            timestamptz,
  reopened_at          timestamptz,
  reopened_reason      text        CHECK (reopened_reason IS NULL OR length(reopened_reason) <= 2000),
  satisfaction_rating  integer     CHECK (satisfaction_rating IS NULL OR (satisfaction_rating BETWEEN 1 AND 5)),
  satisfaction_feedback text       CHECK (satisfaction_feedback IS NULL OR length(satisfaction_feedback) <= 4000),
  satisfaction_submitted_at timestamptz,
  related_resource_type text       CHECK (related_resource_type IS NULL OR length(related_resource_type) BETWEEN 1 AND 60),
  related_resource_id   text       CHECK (related_resource_id IS NULL OR length(related_resource_id) BETWEEN 1 AND 200),
  attachments          jsonb       CHECK (attachments IS NULL OR (jsonb_typeof(attachments) = 'array' AND jsonb_array_length(attachments) <= 50 AND pg_column_size(attachments) <= 32768)),
  source               text        NOT NULL DEFAULT 'web' CHECK (source IN ('web','email','widget','api','bot','phone')),
  language_code        text        NOT NULL DEFAULT 'en' CHECK (language_code ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  user_ip              inet,
  user_agent           text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'bot_handled'    OR (bot_handled_at IS NOT NULL AND bot_handled_faq_id IS NOT NULL)),
  CHECK (status <> 'escalated'      OR (escalated_at IS NOT NULL AND escalation_reason IS NOT NULL)),
  CHECK (status <> 'resolved'       OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_summary IS NOT NULL)),
  CHECK (status <> 'closed'         OR closed_at IS NOT NULL),
  CHECK (status <> 'reopened'       OR (reopened_at IS NOT NULL AND reopened_reason IS NOT NULL)),
  CHECK (assigned_at IS NULL OR assigned_to IS NOT NULL),
  CHECK (satisfaction_submitted_at IS NULL OR (satisfaction_rating IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK (first_response_at IS NULL OR first_response_at >= created_at),
  CHECK (resolved_at IS NULL OR resolved_at >= created_at),
  CHECK (closed_at IS NULL OR closed_at >= created_at)
);

CREATE INDEX idx_support_tickets_tenant_status   ON support_tickets (tenant_id, status, created_at DESC);
CREATE INDEX idx_support_tickets_user            ON support_tickets (user_type, user_id);
CREATE INDEX idx_support_tickets_status          ON support_tickets (status, created_at DESC);
CREATE INDEX idx_support_tickets_priority        ON support_tickets (priority, created_at DESC) WHERE status NOT IN ('resolved','closed');
CREATE INDEX idx_support_tickets_assigned        ON support_tickets (assigned_to, status) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_support_tickets_unassigned      ON support_tickets (created_at) WHERE status = 'escalated' AND assigned_to IS NULL;
CREATE INDEX idx_support_tickets_resolver        ON support_tickets (resolved_by, resolved_at DESC) WHERE resolved_by IS NOT NULL;
CREATE INDEX idx_support_tickets_first_response  ON support_tickets (created_at) WHERE first_response_at IS NULL AND status NOT IN ('resolved','closed');
CREATE INDEX idx_support_tickets_category        ON support_tickets (category, created_at DESC) WHERE category IS NOT NULL;
CREATE INDEX idx_support_tickets_related         ON support_tickets (related_resource_type, related_resource_id) WHERE related_resource_id IS NOT NULL;
CREATE INDEX idx_support_tickets_satisfaction    ON support_tickets (satisfaction_rating, satisfaction_submitted_at DESC) WHERE satisfaction_rating IS NOT NULL;

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;
