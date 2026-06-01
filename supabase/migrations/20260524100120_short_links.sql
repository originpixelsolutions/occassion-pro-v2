-- Phase 3 Unit 24: short_links (spec lines 1649-1670).
-- Tenant-scoped short links with optional event + guest binding.
-- A short link can be:
--   - tenant-only (asset/website shares)
--   - tenant + event (event-wide RSVP/portal URLs)
--   - tenant + event + guest (unique per-guest invitation links)
--
-- link_type enum: invitation | rsvp | portal | website | badge
-- | asset | generic. password_hash optional (link-level
-- password gate, hashed not plain). custom_alias is a
-- vanity alias (slug-format), separately UNIQUE from code.
--
-- code regex: alnum start/end with underscore-and-hyphen
-- interior, 6-32 chars - enough entropy for 62^6 = ~56G unique
-- codes without being unwieldy. custom_alias is slug-style
-- lowercase 4-60 chars.
--
-- destination_url must be http:// or https:// (some legacy
-- vendor sites are http; spec doesn't mandate https for all
-- destinations). Cross-tenant trigger validates event, guest
-- (and the guest's event matches if both are set), and creator
-- member all belong to the link's tenant.

CREATE TABLE short_links (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text        NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{4,30}[A-Za-z0-9]$'),
  custom_alias    text        UNIQUE CHECK (custom_alias IS NULL OR custom_alias ~ '^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$'),
  destination_url text        NOT NULL CHECK (destination_url ~ '^https?://' AND length(destination_url) BETWEEN 1 AND 2048),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid        REFERENCES events(id) ON DELETE CASCADE,
  guest_id        uuid        REFERENCES guests(id) ON DELETE SET NULL,
  link_type       text        NOT NULL CHECK (link_type IN ('invitation','rsvp','portal','website','badge','asset','generic')),
  password_hash   text        CHECK (password_hash IS NULL OR length(password_hash) BETWEEN 50 AND 200),
  expires_at      timestamptz,
  click_count     integer     NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  last_clicked_at timestamptz,
  is_active       boolean     NOT NULL DEFAULT TRUE,
  created_by      uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  purge_after     timestamptz,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (last_clicked_at IS NULL OR last_clicked_at >= created_at),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_short_links_tenant     ON short_links (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_short_links_event      ON short_links (event_id) WHERE event_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_short_links_guest      ON short_links (guest_id) WHERE guest_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_short_links_type       ON short_links (link_type, tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_short_links_active     ON short_links (code) WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_short_links_expiry     ON short_links (expires_at) WHERE expires_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_short_links_creator    ON short_links (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_short_links_purge_due  ON short_links (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION short_links_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; guest_tenant uuid; guest_event uuid; creator_tenant uuid;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
    IF event_tenant IS NULL THEN
      RAISE EXCEPTION 'short_links.event_id % not found', NEW.event_id USING ERRCODE = '23503';
    END IF;
    IF event_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'short_links.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.guest_id IS NOT NULL THEN
    SELECT tenant_id, event_id INTO guest_tenant, guest_event FROM guests WHERE id = NEW.guest_id;
    IF guest_tenant IS NULL THEN
      RAISE EXCEPTION 'short_links.guest_id % not found', NEW.guest_id USING ERRCODE = '23503';
    END IF;
    IF guest_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'short_links.tenant_id % does not match guest tenant %', NEW.tenant_id, guest_tenant USING ERRCODE = '23514';
    END IF;
    IF NEW.event_id IS NOT NULL AND guest_event <> NEW.event_id THEN
      RAISE EXCEPTION 'short_links.guest_id % belongs to event %, not %', NEW.guest_id, guest_event, NEW.event_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'short_links.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_short_links_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, guest_id, created_by ON short_links
  FOR EACH ROW EXECUTE FUNCTION short_links_check_tenant_match();

ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE short_links FORCE ROW LEVEL SECURITY;
