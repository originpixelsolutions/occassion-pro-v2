-- Phase 3 Unit 5: event_readiness_state (spec 4.1).
-- Per-event-per-item readiness checklist progress. Composite PK
-- (event_id, item_id). is_complete couples with completed_at (both set
-- or both NULL). Trigger ensures the readiness item belongs to the
-- event's type.

CREATE TABLE event_readiness_state (
  event_id     uuid        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  item_id      uuid        NOT NULL REFERENCES event_type_readiness_items (id) ON DELETE CASCADE,
  is_complete  boolean     NOT NULL DEFAULT FALSE,
  completed_at timestamptz,
  completed_by uuid        REFERENCES tenant_members (id) ON DELETE SET NULL,
  notes        text        CHECK (notes IS NULL OR length(notes) <= 2000),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, item_id),
  CHECK ((is_complete = FALSE AND completed_at IS NULL  AND completed_by IS NULL)
      OR (is_complete = TRUE  AND completed_at IS NOT NULL))
);

CREATE INDEX idx_readiness_state_item     ON event_readiness_state (item_id);
CREATE INDEX idx_readiness_state_complete ON event_readiness_state (event_id) WHERE is_complete;
CREATE INDEX idx_readiness_state_pending  ON event_readiness_state (event_id) WHERE NOT is_complete;

CREATE OR REPLACE FUNCTION trg_event_readiness_state_type_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event_type_a uuid;
  event_type_b uuid;
BEGIN
  SELECT event_type_id INTO event_type_a FROM events                      WHERE id = NEW.event_id;
  SELECT event_type_id INTO event_type_b FROM event_type_readiness_items WHERE id = NEW.item_id;
  IF event_type_a IS NULL OR event_type_b IS NULL OR event_type_a <> event_type_b THEN
    RAISE EXCEPTION 'event_readiness_state_type_mismatch: event.event_type_id (%) <> item.event_type_id (%)',
                    event_type_a, event_type_b
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_readiness_state_type_match
BEFORE INSERT OR UPDATE OF event_id, item_id ON event_readiness_state
FOR EACH ROW EXECUTE FUNCTION trg_event_readiness_state_type_match();

ALTER TABLE event_readiness_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_readiness_state FORCE ROW LEVEL SECURITY;
