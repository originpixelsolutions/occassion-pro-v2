-- Phase 3 Unit 16: guests (spec 6.x + 19.9.1).
-- Per-event guest record. Tenant-scoped + event-scoped with a
-- BEFORE INSERT/UPDATE trigger asserting guests.tenant_id =
-- events.tenant_id (cross-tenant attack prevention).
--
-- Three state machines coexist:
--   rsvp_status        : pending → attending|not_attending|tentative (free transitions before rsvp_change_deadline_at)
--   registration_status: pending_approval → approved|rejected
--   check_in_status    : not_checked_in → checked_in → checked_out (also no_show)
--
-- GDPR/DPDP anonymization (19.9.1) is enforced at the schema
-- level: when erased_at is set, the four PII columns (email,
-- phone, dietary_requirement, accessibility_needs, notes) MUST
-- be NULL. erased_at and erased_reason are coupled.
--
-- Partial UNIQUE per event on lower(email) and phone — a guest
-- cannot be invited twice to the same event under the same
-- contact identity, but the same email can appear across many
-- events.

CREATE TABLE guests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id              uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                  text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  email                 citext      CHECK (email IS NULL OR (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254)),
  phone                 text        CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  category              text        CHECK (category IS NULL OR length(trim(category)) BETWEEN 1 AND 60),
  table_no              text        CHECK (table_no IS NULL OR length(trim(table_no)) BETWEEN 1 AND 30),
  dietary_requirement   text        CHECK (dietary_requirement IS NULL OR length(dietary_requirement) <= 500),
  accessibility_needs   text        CHECK (accessibility_needs IS NULL OR length(accessibility_needs) <= 500),
  notes                 text        CHECK (notes IS NULL OR length(notes) <= 2000),
  rsvp_status           text        NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN ('pending','attending','not_attending','tentative')),
  rsvp_responded_at     timestamptz,
  registration_status   text        NOT NULL DEFAULT 'pending_approval' CHECK (registration_status IN ('pending_approval','approved','rejected')),
  approved_by           uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  rejection_reason      text        CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500),
  check_in_status       text        NOT NULL DEFAULT 'not_checked_in' CHECK (check_in_status IN ('not_checked_in','checked_in','checked_out','no_show')),
  check_in_at           timestamptz,
  check_out_at          timestamptz,
  invited_at            timestamptz,
  invited_via           text        CHECK (invited_via IS NULL OR invited_via IN ('whatsapp','sms','email','manual','self_registration')),
  short_link_id         uuid,
  erased_at             timestamptz,
  erased_reason         text        CHECK (erased_reason IS NULL OR erased_reason IN ('gdpr_request','dpdp_request','retention_policy','tenant_request','platform_action')),
  deleted_at            timestamptz,
  purge_after           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (rsvp_responded_at IS NULL OR rsvp_status <> 'pending'),
  CONSTRAINT guests_approved_requires_approver CHECK (registration_status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT guests_approver_implies_approved CHECK ((approved_by IS NULL AND approved_at IS NULL) OR registration_status = 'approved'),
  CHECK (registration_status <> 'rejected' OR rejection_reason IS NOT NULL),
  CHECK (check_in_status <> 'checked_in' OR check_in_at IS NOT NULL),
  CHECK (check_in_status <> 'checked_out' OR (check_in_at IS NOT NULL AND check_out_at IS NOT NULL AND check_out_at >= check_in_at)),
  CHECK ((erased_at IS NULL) = (erased_reason IS NULL)),
  CHECK (erased_at IS NULL OR (email IS NULL AND phone IS NULL AND dietary_requirement IS NULL AND notes IS NULL AND accessibility_needs IS NULL)),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_guests_tenant        ON guests (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_guests_event         ON guests (event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_guests_event_rsvp    ON guests (event_id, rsvp_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_guests_event_checkin ON guests (event_id, check_in_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_guests_email         ON guests (lower(email::text)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_guests_phone         ON guests (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_guests_approved_by   ON guests (approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX idx_guests_purge_due     ON guests (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;
CREATE INDEX idx_guests_erased        ON guests (erased_at) WHERE erased_at IS NOT NULL;

CREATE UNIQUE INDEX idx_guests_email_per_event ON guests (event_id, lower(email::text))
  WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_guests_phone_per_event ON guests (event_id, phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION guests_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'guests.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'guests.tenant_id % does not match events.tenant_id %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guests_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id ON guests
  FOR EACH ROW EXECUTE FUNCTION guests_check_tenant_match();
