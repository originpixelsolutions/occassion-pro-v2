-- 0015_whatsapp_templates | Phase 1 | spec 5.2 (platform-owned templates)
CREATE TABLE whatsapp_templates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name    text        NOT NULL CHECK (length(trim(template_name)) > 0),
  category         text        NOT NULL CHECK (category IN ('authentication','transactional','marketing','utility')),
  language_code    text        NOT NULL DEFAULT 'en' CHECK (language_code ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  body_text        text        NOT NULL CHECK (length(trim(body_text)) > 0),
  variables        text[]      NOT NULL DEFAULT '{}',
  meta_status      text        NOT NULL DEFAULT 'pending'
                               CHECK (meta_status IN ('pending','approved','rejected','paused')),
  meta_template_id text,
  dlt_template_id  text,
  dlt_entity_id    text,
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_name, language_code),
  CHECK (meta_status <> 'approved' OR approved_at IS NOT NULL)
);
CREATE INDEX idx_whatsapp_templates_status ON whatsapp_templates (meta_status);
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates FORCE ROW LEVEL SECURITY;
