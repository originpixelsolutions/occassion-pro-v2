-- Phase 8 Unit 55: onboarding_state (spec 30.1 line 3750).
-- Per-tenant onboarding wizard progress. PK = tenant_id makes
-- this a singleton row per tenant.
--
-- Six timestamp milestones from the spec (signup_completed_at,
-- workspace_setup_at, first_event_created_at, first_member_
-- invited_at, payment_setup_at, tour_completed_at) plus
-- tour_skipped_at, template_used_at, demo_data_loaded_at,
-- demo_data_cleared_at, email_sequence_completed_at, last_
-- active_at.
--
-- current_tour_step enum matches the spec's 7-step tour:
-- welcome / branding / first_event / portal_tour / invite_team
-- / payment / next_steps. total_tour_steps defaults to 7.
--
-- Three coupling CHECKs:
--   tour_completed_at AND tour_skipped_at cannot both be set
--   template_used <-> template_used_at coupled both ways
--   demo_data_loaded=TRUE requires demo_data_loaded_at
--   demo_data_cleared_at requires a prior load
--
-- Two time-order CHECKs:
--   workspace_setup_at >= signup_completed_at (when both set)
--   first_event_created_at >= signup_completed_at (when both set)
--
-- completion_percent bounded 0..100. checklist_progress jsonb
-- (per-item TRUE/FALSE map) capped at 8 KiB and must be an
-- object.
--
-- Six partial indexes target the onboarding worker's hot
-- paths: active-but-incomplete tenants, completed tour
-- analytics, template adoption, completion percentile,
-- email-sequence work queue, and the 'never created an event'
-- nudge trigger.

CREATE TABLE onboarding_state (
  tenant_id              uuid        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  signup_completed_at    timestamptz,
  workspace_setup_at     timestamptz,
  first_event_created_at timestamptz,
  first_member_invited_at timestamptz,
  payment_setup_at       timestamptz,
  tour_completed_at      timestamptz,
  tour_skipped_at        timestamptz,
  current_tour_step      text        CHECK (current_tour_step IS NULL OR current_tour_step IN ('welcome','branding','first_event','portal_tour','invite_team','payment','next_steps')),
  current_tour_step_index integer    CHECK (current_tour_step_index IS NULL OR (current_tour_step_index >= 1 AND current_tour_step_index <= 50)),
  total_tour_steps       integer     NOT NULL DEFAULT 7 CHECK (total_tour_steps >= 1 AND total_tour_steps <= 50),
  template_used          text        CHECK (template_used IS NULL OR length(trim(template_used)) BETWEEN 1 AND 100),
  template_used_at       timestamptz,
  demo_data_loaded       boolean     NOT NULL DEFAULT FALSE,
  demo_data_loaded_at    timestamptz,
  demo_data_cleared_at   timestamptz,
  checklist_progress     jsonb       CHECK (checklist_progress IS NULL OR (jsonb_typeof(checklist_progress) = 'object' AND pg_column_size(checklist_progress) <= 8192)),
  completion_percent     integer     NOT NULL DEFAULT 0 CHECK (completion_percent >= 0 AND completion_percent <= 100),
  email_sequence_paused  boolean     NOT NULL DEFAULT FALSE,
  email_sequence_completed_at timestamptz,
  last_active_at         timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (tour_completed_at IS NULL OR tour_skipped_at IS NULL),
  CHECK ((template_used IS NULL) = (template_used_at IS NULL)),
  CHECK ((demo_data_loaded = FALSE) OR demo_data_loaded_at IS NOT NULL),
  CHECK (demo_data_cleared_at IS NULL OR demo_data_loaded_at IS NOT NULL),
  CHECK (workspace_setup_at IS NULL OR signup_completed_at IS NULL OR workspace_setup_at >= signup_completed_at),
  CHECK (first_event_created_at IS NULL OR signup_completed_at IS NULL OR first_event_created_at >= signup_completed_at)
);

CREATE INDEX idx_onboarding_state_active        ON onboarding_state (last_active_at) WHERE tour_completed_at IS NULL AND tour_skipped_at IS NULL;
CREATE INDEX idx_onboarding_state_completed     ON onboarding_state (tour_completed_at) WHERE tour_completed_at IS NOT NULL;
CREATE INDEX idx_onboarding_state_template      ON onboarding_state (template_used) WHERE template_used IS NOT NULL;
CREATE INDEX idx_onboarding_state_completion    ON onboarding_state (completion_percent);
CREATE INDEX idx_onboarding_state_email_pending ON onboarding_state (signup_completed_at) WHERE email_sequence_paused = FALSE AND email_sequence_completed_at IS NULL AND signup_completed_at IS NOT NULL;
CREATE INDEX idx_onboarding_state_no_event      ON onboarding_state (signup_completed_at) WHERE first_event_created_at IS NULL AND signup_completed_at IS NOT NULL;

ALTER TABLE onboarding_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_state FORCE ROW LEVEL SECURITY;
