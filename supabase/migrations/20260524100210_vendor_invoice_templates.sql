-- Phase 4 Unit 42: vendor_invoice_templates (spec line 2096).
-- Vendor uploads a custom invoice template used when
-- generating invoices to the tenant. template_type enum:
--   html         : template_html field carries the markup
--   pdf_overlay  : template_file_r2_key carries the PDF
--   docx         : template_file_r2_key carries the DOCX
--
-- Two row-level CHECKs gate the artefact location on type:
-- html requires template_html NOT NULL; pdf_overlay and docx
-- require template_file_r2_key NOT NULL.
--
-- Template HTML capped at 1 MiB, file size capped at 10 MiB,
-- hash regex matches lowercase 64-hex sha256.
--
-- Partial UNIQUE on (vendor_account_id) WHERE is_default=TRUE
-- AND not soft-deleted: at most one default template per
-- vendor. Partial UNIQUE on (vendor_account_id, lower(name))
-- prevents 'Standard Invoice' and 'standard invoice' from
-- coexisting per vendor.
--
-- is_active toggles whether the template can be picked from
-- the dropdown; retired_at (with reason) is the audit trail
-- for retirements. The two booleans are mutually consistent
-- via CHECK (NOT is_active OR retired_at IS NULL).

CREATE TABLE vendor_invoice_templates (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id      uuid        NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  name                   text        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  template_type          text        NOT NULL CHECK (template_type IN ('html','pdf_overlay','docx')),
  template_file_r2_key   text        CHECK (template_file_r2_key IS NULL OR length(template_file_r2_key) BETWEEN 1 AND 1024),
  template_html          text        CHECK (template_html IS NULL OR length(template_html) <= 1048576),
  template_file_size_bytes bigint    CHECK (template_file_size_bytes IS NULL OR (template_file_size_bytes > 0 AND template_file_size_bytes <= 10485760)),
  template_file_hash_sha256 text     CHECK (template_file_hash_sha256 IS NULL OR template_file_hash_sha256 ~ '^[a-f0-9]{64}$'),
  default_logo_url       text        CHECK (default_logo_url IS NULL OR (default_logo_url ~ '^https://' AND length(default_logo_url) BETWEEN 1 AND 2048)),
  default_terms          text        CHECK (default_terms IS NULL OR length(default_terms) <= 16384),
  default_payment_terms_days integer CHECK (default_payment_terms_days IS NULL OR (default_payment_terms_days >= 0 AND default_payment_terms_days <= 365)),
  default_currency_code  varchar(3)  CHECK (default_currency_code IS NULL OR default_currency_code ~ '^[A-Z]{3}$'),
  is_default             boolean     NOT NULL DEFAULT FALSE,
  is_active              boolean     NOT NULL DEFAULT TRUE,
  retired_at             timestamptz,
  retired_reason         text        CHECK (retired_reason IS NULL OR length(retired_reason) <= 1000),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  CHECK (template_type <> 'html' OR template_html IS NOT NULL),
  CHECK (template_type = 'html' OR template_file_r2_key IS NOT NULL),
  CHECK (NOT is_active OR retired_at IS NULL),
  CHECK (retired_at IS NULL OR retired_reason IS NOT NULL)
);

CREATE UNIQUE INDEX uq_vendor_invoice_templates_default
  ON vendor_invoice_templates (vendor_account_id) WHERE is_default = TRUE AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_vendor_invoice_templates_name
  ON vendor_invoice_templates (vendor_account_id, lower(name)) WHERE deleted_at IS NULL;

CREATE INDEX idx_vendor_templates        ON vendor_invoice_templates (vendor_account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_templates_active ON vendor_invoice_templates (vendor_account_id) WHERE is_active = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_vendor_templates_type   ON vendor_invoice_templates (vendor_account_id, template_type) WHERE deleted_at IS NULL;

ALTER TABLE vendor_invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_invoice_templates FORCE ROW LEVEL SECURITY;
