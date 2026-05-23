-- 0011_event_types_system | Phase 1 | spec 4.1 (system rows only)
-- FK to tenants is added in Phase 2 (forward reference).
CREATE TABLE event_types (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  code          text        NOT NULL CHECK (length(trim(code)) > 0),
  name          text        NOT NULL CHECK (length(trim(name)) > 0),
  icon          text,
  description   text,
  is_system     boolean     NOT NULL DEFAULT FALSE,
  tone          text        NOT NULL DEFAULT 'celebratory'
                            CHECK (tone IN ('celebratory','solemn','formal','playful')),
  default_fnb_style text,
  default_session_duration interval,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((tenant_id IS NULL AND is_system = TRUE) OR (tenant_id IS NOT NULL AND is_system = FALSE))
);
CREATE UNIQUE INDEX idx_event_types_system_code ON event_types (code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX idx_event_types_tenant_code ON event_types (tenant_id, code) WHERE tenant_id IS NOT NULL;
ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_types FORCE ROW LEVEL SECURITY;
