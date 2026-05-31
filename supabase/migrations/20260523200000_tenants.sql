-- Phase 2 Unit 1: tenants
-- Spec composed from 3.4 (signup), 3.5 (slug), 3.6 (rename),
-- 3.17 (tax / business country), 33.10.2 (white-label overrides),
-- 19.9 (regional data residency).
-- Also resolves Phase 1 deferred forward-FKs on event_types and event_templates.

CREATE TABLE tenants (
  id                                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                              text        NOT NULL UNIQUE
                                                CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  company_name                      text        NOT NULL CHECK (length(trim(company_name)) > 0),
  legal_name                        text,
  logo_url                          text,
  timezone                          text        NOT NULL DEFAULT 'Asia/Kolkata',
  billing_currency                  varchar(3)  NOT NULL CHECK (billing_currency ~ '^[A-Z]{3}$'),
  business_country                  text        CHECK (business_country IS NULL OR business_country ~ '^[A-Z]{2}$'),
  gstin                             text,
  vat_number                        text,
  tax_exempt_certificate            text,
  previous_company_names            jsonb       NOT NULL DEFAULT '[]'::jsonb
                                                CHECK (jsonb_typeof(previous_company_names) = 'array'),
  status                            text        NOT NULL DEFAULT 'active'
                                                CHECK (status IN ('active','suspended','cancelled')),
  brand_primary_override            hex_color,
  brand_secondary_override          hex_color,
  brand_gradient_start_override     hex_color,
  brand_gradient_end_override       hex_color,
  guest_portal_theme_override       jsonb,
  public_website_theme_override     jsonb,
  invitation_default_theme_override jsonb,
  suspended_at                      timestamptz,
  suspended_reason                  text,
  suspended_by                      uuid        REFERENCES super_admins(id) ON DELETE SET NULL,
  cancelled_at                      timestamptz,
  cancellation_reason               text,
  region                            text        NOT NULL DEFAULT 'ap-south-1',
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'suspended' OR (suspended_at IS NOT NULL AND suspended_reason IS NOT NULL)),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

CREATE INDEX idx_tenants_status       ON tenants (status) WHERE status = 'active';
CREATE INDEX idx_tenants_created_at   ON tenants (created_at DESC);
CREATE INDEX idx_tenants_suspended_by ON tenants (suspended_by) WHERE suspended_by IS NOT NULL;

CREATE OR REPLACE FUNCTION tenants_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_set_updated_at();

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

-- Resolve Phase 1 deferred forward-FKs
ALTER TABLE event_types
  ADD CONSTRAINT event_types_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE event_templates
  ADD CONSTRAINT event_templates_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX idx_event_types_tenant_id     ON event_types (tenant_id)     WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_event_templates_tenant_id ON event_templates (tenant_id) WHERE tenant_id IS NOT NULL;
