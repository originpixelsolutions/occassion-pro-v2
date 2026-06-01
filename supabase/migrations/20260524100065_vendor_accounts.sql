-- Phase 3 Unit 14: vendor_accounts (spec 7.2).
-- Cross-tenant vendor portal. citext email globally UNIQUE.
-- Mirrors client_accounts auth/MFA/lockout/suspend/soft-delete
-- model. Vendor-specific: company_name, contact_name, tax_id,
-- default_currency (ISO 4217), bank_account_encrypted (bytea
-- ciphertext) paired with bank_kms_key_id so we always know
-- which key the envelope was encrypted under.

CREATE TABLE vendor_accounts (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   citext      NOT NULL UNIQUE CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  company_name            text        CHECK (company_name IS NULL OR length(trim(company_name)) BETWEEN 1 AND 200),
  contact_name            text        CHECK (contact_name IS NULL OR length(trim(contact_name)) BETWEEN 1 AND 200),
  phone                   text        CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  password_hash           text        NOT NULL CHECK (length(password_hash) BETWEEN 50 AND 200),
  mfa_secret              bytea       CHECK (mfa_secret IS NULL OR octet_length(mfa_secret) > 0),
  mfa_enabled             boolean     NOT NULL DEFAULT FALSE,
  recovery_email          citext      CHECK (recovery_email IS NULL OR (recovery_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(recovery_email) <= 254)),
  recovery_phone          text        CHECK (recovery_phone IS NULL OR recovery_phone ~ '^\+[1-9][0-9]{6,14}$'),
  tax_id                  text        CHECK (tax_id IS NULL OR length(trim(tax_id)) BETWEEN 1 AND 50),
  default_currency        varchar(3)  CHECK (default_currency IS NULL OR default_currency ~ '^[A-Z]{3}$'),
  bank_account_encrypted  bytea       CHECK (bank_account_encrypted IS NULL OR octet_length(bank_account_encrypted) BETWEEN 1 AND 4096),
  bank_kms_key_id         text        CHECK (bank_kms_key_id IS NULL OR length(bank_kms_key_id) BETWEEN 1 AND 200),
  failed_login_count      integer     NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until            timestamptz,
  last_login_at           timestamptz,
  last_login_ip           inet,
  suspended_at            timestamptz,
  suspended_reason        text        CHECK (suspended_reason IS NULL OR length(suspended_reason) <= 2000),
  email_verified_at       timestamptz,
  deleted_at              timestamptz,
  purge_after             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (mfa_enabled = FALSE OR mfa_secret IS NOT NULL),
  CHECK (suspended_at IS NULL OR suspended_reason IS NOT NULL),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL),
  CHECK (locked_until IS NULL OR locked_until > created_at),
  CHECK ((bank_account_encrypted IS NULL) = (bank_kms_key_id IS NULL))
);

CREATE INDEX idx_vendor_accounts_phone        ON vendor_accounts (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_vendor_accounts_locked       ON vendor_accounts (locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX idx_vendor_accounts_suspended    ON vendor_accounts (suspended_at) WHERE suspended_at IS NOT NULL;
CREATE INDEX idx_vendor_accounts_unverified   ON vendor_accounts (created_at) WHERE email_verified_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_vendor_accounts_purge_due    ON vendor_accounts (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;
CREATE INDEX idx_vendor_accounts_company_name ON vendor_accounts (lower(company_name)) WHERE company_name IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE vendor_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_accounts FORCE ROW LEVEL SECURITY;
