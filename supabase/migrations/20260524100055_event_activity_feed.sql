-- Phase 3 Unit 12: event_activity_feed (spec 13.6).
-- Append-only event activity stream. bigserial PK because volume can be
-- very high. 7-value actor_type enum and a curated 50+ activity_type
-- enum. data is jsonb object (validated). Triggers: tenant-match before
-- insert; immutability of identifying columns before update.

CREATE TABLE event_activity_feed (
  id                bigserial   PRIMARY KEY,
  tenant_id         uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_id          uuid        NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  actor_id          uuid,
  actor_type        text        NOT NULL CHECK (actor_type IN ('tenant_member','client','vendor','guest','speaker','system','super_admin')),
  actor_name_cached text        CHECK (actor_name_cached IS NULL OR length(trim(actor_name_cached)) BETWEEN 1 AND 200),
  activity_type     text        NOT NULL CHECK (activity_type IN (
                                  'event_created','event_updated','event_completed','event_cancelled','event_archived',
                                  'guest_added','guest_removed','guest_imported','rsvp_changed','guest_check_in',
                                  'vendor_assigned','vendor_unassigned','vendor_confirmed','vendor_quote_submitted',
                                  'task_added','task_updated','task_completed','task_reassigned','task_overdue',
                                  'file_uploaded','file_deleted','folder_created',
                                  'comment_added','comment_edited','comment_deleted','mention_added',
                                  'payment_received','payment_failed','invoice_sent','invoice_paid','refund_issued',
                                  'budget_updated','expense_added','expense_approved',
                                  'crew_assigned','crew_checked_in','crew_checked_out',
                                  'ticket_purchased','ticket_refunded','ticket_used',
                                  'website_published','website_unpublished',
                                  'speaker_added','session_scheduled','session_started','session_ended',
                                  'feedback_received','testimonial_received',
                                  'status_changed','permission_changed','other'
                                )),
  entity_type       text        CHECK (entity_type IS NULL OR length(trim(entity_type)) BETWEEN 1 AND 80),
  entity_id         uuid,
  description       text        NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
  data              jsonb       CHECK (data IS NULL OR jsonb_typeof(data) = 'object'),
  is_internal       boolean     NOT NULL DEFAULT FALSE,
  ip_address        inet,
  source            text        CHECK (source IS NULL OR source IN ('web','mobile','api','webhook','worker','admin','import')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((entity_id IS NULL AND entity_type IS NULL) OR (entity_type IS NOT NULL))
);

CREATE INDEX idx_activity_event_time  ON event_activity_feed (event_id, created_at);
CREATE INDEX idx_activity_actor       ON event_activity_feed (actor_type, actor_id);
CREATE INDEX idx_activity_type        ON event_activity_feed (event_id, activity_type, created_at);
CREATE INDEX idx_activity_public      ON event_activity_feed (event_id, created_at) WHERE NOT is_internal;
CREATE INDEX idx_activity_tenant_time ON event_activity_feed (tenant_id, created_at);
CREATE INDEX idx_activity_entity      ON event_activity_feed (entity_type, entity_id) WHERE entity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_event_activity_feed_tenant_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL OR event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'event_activity_feed_tenant_mismatch: event tenant (%) <> activity tenant (%)',
                    event_tenant, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_activity_feed_tenant_match
BEFORE INSERT ON event_activity_feed
FOR EACH ROW EXECUTE FUNCTION trg_event_activity_feed_tenant_match();

CREATE OR REPLACE FUNCTION trg_event_activity_feed_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id              <> OLD.id              THEN RAISE EXCEPTION 'immutable: id'              USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.tenant_id       <> OLD.tenant_id       THEN RAISE EXCEPTION 'immutable: tenant_id'       USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.event_id        <> OLD.event_id        THEN RAISE EXCEPTION 'immutable: event_id'        USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.actor_type      <> OLD.actor_type      THEN RAISE EXCEPTION 'immutable: actor_type'      USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.activity_type   <> OLD.activity_type   THEN RAISE EXCEPTION 'immutable: activity_type'   USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.description     <> OLD.description     THEN RAISE EXCEPTION 'immutable: description'     USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.created_at      <> OLD.created_at      THEN RAISE EXCEPTION 'immutable: created_at'      USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_activity_feed_append_only
BEFORE UPDATE ON event_activity_feed
FOR EACH ROW EXECUTE FUNCTION trg_event_activity_feed_append_only();

ALTER TABLE event_activity_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_activity_feed FORCE ROW LEVEL SECURITY;
