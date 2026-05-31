-- Phase 2 Unit 5: tenant_slug_aliases (spec 3.5).
-- 90-day slug redirect map. A trigger enforces "at most one ACTIVE alias
-- per old_slug" (now() isn't IMMUTABLE, so a partial unique index won't fly).

CREATE TABLE tenant_slug_aliases (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  old_slug       text        NOT NULL CHECK (old_slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  new_slug       text        NOT NULL CHECK (new_slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  redirect_until timestamptz NOT NULL,
  reason         text        CHECK (reason IS NULL OR length(reason) <= 500),
  changed_by     uuid        REFERENCES super_admins (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (old_slug <> new_slug),
  CHECK (redirect_until > created_at)
);

CREATE INDEX idx_slug_alias_tenant ON tenant_slug_aliases (tenant_id);
CREATE INDEX idx_slug_alias_new ON tenant_slug_aliases (new_slug);
CREATE INDEX idx_slug_alias_changed_by ON tenant_slug_aliases (changed_by) WHERE changed_by IS NOT NULL;
CREATE INDEX idx_slug_alias_old_until ON tenant_slug_aliases (old_slug, redirect_until);

CREATE OR REPLACE FUNCTION trg_slug_alias_no_active_dup() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tenant_slug_aliases
     WHERE old_slug = NEW.old_slug
       AND id <> NEW.id
       AND redirect_until > now()
  ) THEN
    RAISE EXCEPTION 'slug_alias_active_conflict: % is already an active redirect', NEW.old_slug
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_slug_alias_no_active_dup
BEFORE INSERT OR UPDATE ON tenant_slug_aliases
FOR EACH ROW EXECUTE FUNCTION trg_slug_alias_no_active_dup();

ALTER TABLE tenant_slug_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_slug_aliases FORCE ROW LEVEL SECURITY;
