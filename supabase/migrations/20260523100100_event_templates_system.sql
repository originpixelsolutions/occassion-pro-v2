-- 0013_event_templates_system | Phase 1 | spec 4.2 (system kits only)
-- FKs to tenants / tenant_members added in Phase 2.
CREATE TABLE event_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid,
  code            text        NOT NULL CHECK (length(trim(code)) > 0),
  name            text        NOT NULL CHECK (length(trim(name)) > 0),
  description     text,
  cover_image_url text,
  event_type_id   uuid        REFERENCES event_types(id) ON DELETE CASCADE,
  scaffold        jsonb       NOT NULL CHECK (jsonb_typeof(scaffold) = 'object'),
  is_system       boolean     NOT NULL DEFAULT FALSE,
  is_published    boolean     NOT NULL DEFAULT TRUE,
  use_count       integer     NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scaffold_size_limit CHECK (octet_length(scaffold::text) < 524288),
  CHECK ((tenant_id IS NULL AND is_system = TRUE) OR (tenant_id IS NOT NULL AND is_system = FALSE))
);
CREATE INDEX idx_templates_type   ON event_templates (event_type_id);
CREATE INDEX idx_templates_system ON event_templates (is_system) WHERE is_system = TRUE;
CREATE INDEX idx_templates_tenant ON event_templates (tenant_id) WHERE tenant_id IS NOT NULL;
ALTER TABLE event_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_templates FORCE ROW LEVEL SECURITY;
