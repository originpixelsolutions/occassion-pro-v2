-- Phase 3 Unit 8: event_websites (spec 6.x).
-- Per-event public landing page. PK = event_id (singleton per event).
-- sections/theme/seo jsonb with size caps. is_published <->
-- published_at coupling. UNIQUE custom_host on live rows.
-- Trigger blocks cross-tenant website rows.

CREATE TABLE event_websites (
  event_id       uuid        PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  tenant_id      uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  is_published   boolean     NOT NULL DEFAULT FALSE,
  sections       jsonb       NOT NULL,
  theme_config   jsonb,
  seo_config     jsonb,
  custom_css     text        CHECK (custom_css IS NULL OR length(custom_css) <= 524288),
  custom_host    text        CHECK (custom_host IS NULL OR custom_host ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'),
  published_at   timestamptz,
  unpublished_at timestamptz,
  deleted_at     timestamptz,
  purge_after    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sections_size_limit CHECK (jsonb_typeof(sections) = 'object' AND octet_length(sections::text) < 2097152),
  CONSTRAINT theme_size_limit    CHECK (theme_config IS NULL OR (jsonb_typeof(theme_config) = 'object' AND octet_length(theme_config::text) < 262144)),
  CONSTRAINT seo_size_limit      CHECK (seo_config   IS NULL OR (jsonb_typeof(seo_config)   = 'object' AND octet_length(seo_config::text)   < 65536)),
  CHECK ((is_published = FALSE AND published_at IS NULL) OR (is_published = TRUE AND published_at IS NOT NULL)),
  CHECK (unpublished_at IS NULL OR published_at IS NOT NULL),
  CHECK (purge_after    IS NULL OR deleted_at   IS NOT NULL)
);

CREATE UNIQUE INDEX uq_event_websites_custom_host
  ON event_websites (custom_host) WHERE custom_host IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_event_websites_tenant    ON event_websites (tenant_id);
CREATE INDEX idx_event_websites_published ON event_websites (tenant_id, published_at) WHERE is_published AND deleted_at IS NULL;
CREATE INDEX idx_event_websites_purge_due ON event_websites (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_event_websites_tenant_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL OR event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'event_websites_tenant_mismatch: event tenant (%) <> website tenant (%)',
                    event_tenant, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_websites_tenant_match
BEFORE INSERT OR UPDATE OF tenant_id, event_id ON event_websites
FOR EACH ROW EXECUTE FUNCTION trg_event_websites_tenant_match();

ALTER TABLE event_websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_websites FORCE ROW LEVEL SECURITY;
