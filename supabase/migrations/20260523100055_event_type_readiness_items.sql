-- 0012_event_type_readiness_items | Phase 1 | spec 4.1
CREATE TABLE event_type_readiness_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id uuid        NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  label         text        NOT NULL CHECK (length(trim(label)) > 0),
  module        text,
  check_query   text,
  weight        integer     NOT NULL DEFAULT 1 CHECK (weight >= 0),
  sort_order    integer     NOT NULL DEFAULT 0
);
CREATE INDEX idx_readiness_items_type ON event_type_readiness_items (event_type_id);
ALTER TABLE event_type_readiness_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_type_readiness_items FORCE ROW LEVEL SECURITY;
