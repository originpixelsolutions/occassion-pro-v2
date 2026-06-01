-- Phase 8 Unit 51a: whatsapp_templates HARDENING (spec 5.2 line 1590).
-- The base table was created in Phase 1 (foundational baseline)
-- with just the minimum columns. This migration ALTERs it to
-- add the production columns + tight CHECKs without
-- re-creating, so the Phase 1 migration history stays
-- immutable.
--
-- Added columns: header_format, header_text, footer_text,
-- example_values jsonb, buttons jsonb, meta_rejection_reason,
-- dlt_content_type, is_system, submitted_at, rejected_at,
-- paused_at, disabled_at, disabled_reason, last_sync_at,
-- updated_at, deleted_at.
--
-- meta_status enum extended from spec's 4 to 5 (added
-- 'disabled' for Meta-side disable). Four per-state prereq
-- CHECKs:
--   approved : approved_at AND meta_template_id NOT NULL
--   rejected : rejected_at AND meta_rejection_reason NOT NULL
--   paused   : paused_at NOT NULL
--   disabled : disabled_at AND disabled_reason NOT NULL
--
-- template_name regex enforces canonical Meta format
-- (lowercase, underscores, alnum start/end, max 512). DLT
-- IDs validated as 14-25 digit numeric strings (TRAI's
-- canonical PE/DLT ID range). buttons jsonb capped at 10
-- per Meta's button limit.

ALTER TABLE whatsapp_templates
  ADD COLUMN IF NOT EXISTS header_format text,
  ADD COLUMN IF NOT EXISTS header_text text,
  ADD COLUMN IF NOT EXISTS footer_text text,
  ADD COLUMN IF NOT EXISTS example_values jsonb,
  ADD COLUMN IF NOT EXISTS buttons jsonb,
  ADD COLUMN IF NOT EXISTS meta_rejection_reason text,
  ADD COLUMN IF NOT EXISTS dlt_content_type text,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE whatsapp_templates DROP CONSTRAINT IF EXISTS whatsapp_templates_meta_status_check;
ALTER TABLE whatsapp_templates ADD CONSTRAINT whatsapp_templates_meta_status_check
  CHECK (meta_status IN ('pending','approved','rejected','paused','disabled'));

ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_name_fmt
  CHECK (template_name ~ '^[a-z][a-z0-9_]{0,250}[a-z0-9]$' AND length(template_name) BETWEEN 1 AND 512);
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_language_fmt
  CHECK (language_code ~ '^[a-z]{2,3}(_[A-Z]{2})?$');
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_body_len
  CHECK (length(trim(body_text)) BETWEEN 1 AND 1024);
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_header_format
  CHECK (header_format IS NULL OR header_format IN ('none','text','image','video','document','location'));
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_header_text_len
  CHECK (header_text IS NULL OR length(header_text) <= 60);
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_footer_text_len
  CHECK (footer_text IS NULL OR length(footer_text) <= 60);
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_variables_count
  CHECK (variables IS NULL OR (array_length(variables, 1) IS NULL OR array_length(variables, 1) <= 30));
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_example_shape
  CHECK (example_values IS NULL OR (jsonb_typeof(example_values) IN ('array','object') AND pg_column_size(example_values) <= 32768));
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_buttons_shape
  CHECK (buttons IS NULL OR (jsonb_typeof(buttons) = 'array' AND jsonb_array_length(buttons) <= 10 AND pg_column_size(buttons) <= 16384));
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_dlt_template_fmt
  CHECK (dlt_template_id IS NULL OR dlt_template_id ~ '^[0-9]{14,25}$');
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_dlt_entity_fmt
  CHECK (dlt_entity_id IS NULL OR dlt_entity_id ~ '^[0-9]{14,25}$');
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_dlt_content_type
  CHECK (dlt_content_type IS NULL OR dlt_content_type IN ('transactional','service_implicit','service_explicit','promotional'));
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_approved_coupling
  CHECK (meta_status <> 'approved' OR (approved_at IS NOT NULL AND meta_template_id IS NOT NULL));
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_rejected_coupling
  CHECK (meta_status <> 'rejected' OR (rejected_at IS NOT NULL AND meta_rejection_reason IS NOT NULL));
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_paused_coupling
  CHECK (meta_status <> 'paused' OR paused_at IS NOT NULL);
ALTER TABLE whatsapp_templates ADD CONSTRAINT wt_disabled_coupling
  CHECK (meta_status <> 'disabled' OR (disabled_at IS NOT NULL AND disabled_reason IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_templates_meta
  ON whatsapp_templates (meta_template_id) WHERE meta_template_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_category ON whatsapp_templates (category, meta_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_status   ON whatsapp_templates (meta_status, last_sync_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_pending  ON whatsapp_templates (submitted_at) WHERE meta_status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_active   ON whatsapp_templates (template_name, language_code) WHERE meta_status = 'approved' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_dlt      ON whatsapp_templates (dlt_template_id) WHERE dlt_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_system   ON whatsapp_templates (template_name) WHERE is_system = TRUE AND deleted_at IS NULL;

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates FORCE ROW LEVEL SECURITY;
