-- Phase 3 Unit 4: event_type_readiness_items (hardening).
-- Phase 1 created the bare table (label, module, check_query, weight,
-- sort_order). This migration hardens it for the worker:
--   - module pinned to the 31-value permission-module enum
--   - check_query length-capped at 8000 chars
--   - weight bounds tightened to 0..100
--   - new columns: description, is_active, updated_at
--   - new CHECK on label (1..200)
--   - case-insensitive UNIQUE (event_type_id, lower(label))
--   - new partial indexes for active items and module lookups

ALTER TABLE event_type_readiness_items
  ADD COLUMN description text CHECK (description IS NULL OR length(description) <= 2000),
  ADD COLUMN is_active   boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now();

ALTER TABLE event_type_readiness_items
  DROP CONSTRAINT IF EXISTS event_type_readiness_items_label_check,
  DROP CONSTRAINT IF EXISTS event_type_readiness_items_weight_check;

ALTER TABLE event_type_readiness_items
  ADD CONSTRAINT etri_label_len  CHECK (length(trim(label)) BETWEEN 1 AND 200),
  ADD CONSTRAINT etri_module_enum CHECK (
    module IS NULL OR module IN (
      'events','event_templates','event_types','clients','vendors','guests',
      'runsheet','budget','expenses','payments','invoices','contracts',
      'documents','tasks','crew','f_and_b','inventory','floorplan',
      'shared_inbox','calendar','reports','team_members','settings','billing',
      'integrations','audit_log','api_keys','custom_domains','sso','exports','webhooks'
    )
  ),
  ADD CONSTRAINT etri_check_query_len CHECK (check_query IS NULL OR length(check_query) BETWEEN 1 AND 8000),
  ADD CONSTRAINT etri_weight_bounds   CHECK (weight BETWEEN 0 AND 100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_readiness_items_label
  ON event_type_readiness_items (event_type_id, lower(label));

CREATE INDEX IF NOT EXISTS idx_readiness_items_active
  ON event_type_readiness_items (event_type_id, sort_order) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_readiness_items_module
  ON event_type_readiness_items (module) WHERE module IS NOT NULL;
