-- Phase 3 Unit 23: invitations (spec 6.1, line 1718).
-- Digital animated invitations. 10 templates per spec, three
-- variants (static / animated_web / video), drag-drop builder
-- output stored as jsonb config (<1 MiB hard cap, jsonb_typeof
-- = 'object' to prevent arrays / scalars).
--
-- Publish lifecycle: is_published=TRUE requires both
-- published_at AND published_by NOT NULL. unpublished_at is
-- only meaningful after a publish event, so it must be >=
-- published_at when set. variant='video' requires video_url
-- to be non-null at the row level (a video invite without a
-- video URL is a contradiction).
--
-- Partial UNIQUE on (event_id, template_code) WHERE deleted_at
-- IS NULL keeps the "one invitation per template per event"
-- rule but allows replacement after a soft-delete.
--
-- Three-way tenant-match trigger: event + created_by member +
-- published_by member all belong to the invitation's tenant.

CREATE TABLE invitations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  template_code   text        NOT NULL CHECK (template_code ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  variant         text        NOT NULL DEFAULT 'static' CHECK (variant IN ('static','animated_web','video')),
  config          jsonb       NOT NULL CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) < 1048576),
  preview_url     text        CHECK (preview_url IS NULL OR (preview_url ~ '^https://' AND length(preview_url) BETWEEN 1 AND 2048)),
  pdf_url         text        CHECK (pdf_url IS NULL OR (pdf_url ~ '^https://' AND length(pdf_url) BETWEEN 1 AND 2048)),
  png_url         text        CHECK (png_url IS NULL OR (png_url ~ '^https://' AND length(png_url) BETWEEN 1 AND 2048)),
  video_url       text        CHECK (video_url IS NULL OR (video_url ~ '^https://' AND length(video_url) BETWEEN 1 AND 2048)),
  is_published    boolean     NOT NULL DEFAULT FALSE,
  published_at    timestamptz,
  published_by    uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  unpublished_at  timestamptz,
  version         integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by      uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  purge_after     timestamptz,
  CHECK (is_published = FALSE OR (published_at IS NOT NULL AND published_by IS NOT NULL)),
  CHECK (variant <> 'video' OR video_url IS NOT NULL),
  CHECK (unpublished_at IS NULL OR (published_at IS NOT NULL AND unpublished_at >= published_at)),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_invitations_event       ON invitations (event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_invitations_tenant      ON invitations (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_invitations_template    ON invitations (template_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_invitations_published   ON invitations (event_id, published_at) WHERE is_published = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_invitations_created_by  ON invitations (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_invitations_purge_due   ON invitations (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE UNIQUE INDEX uq_invitations_event_template_active
  ON invitations (event_id, template_code) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION invitations_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; creator_tenant uuid; publisher_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'invitations.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'invitations.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'invitations.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.published_by IS NOT NULL THEN
    SELECT tenant_id INTO publisher_tenant FROM tenant_members WHERE id = NEW.published_by;
    IF publisher_tenant IS NULL OR publisher_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'invitations.published_by % does not belong to tenant %', NEW.published_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invitations_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, created_by, published_by ON invitations
  FOR EACH ROW EXECUTE FUNCTION invitations_check_tenant_match();

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
