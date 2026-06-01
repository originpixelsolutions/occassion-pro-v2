-- Phase 3 Unit 39: vendor_crew_members (spec line 2063).
-- Vendor's own crew roster (head chefs, servers, photographers,
-- etc.). Distinct from the tenant-side crew_pool table: this
-- is per-vendor staff that the vendor brings to events, while
-- crew_pool is freelance crew the tenant hires directly.
--
-- role enum expanded from spec's 4 examples to 15 common
-- event-industry roles to keep the column queryable without a
-- separate lookup table. status enum: active / inactive, with
-- deactivated_at coupled to status='inactive'.
--
-- hourly_rate paired with currency_code via two-way coupling
-- CHECK. citext email + ISO-8601-ish phone regex match the
-- account-level discipline. Five indexes (one general + a
-- per-role active filter + phone + email + name).

CREATE TABLE vendor_crew_members (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id   uuid        NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  full_name           text        NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 200),
  role                text        CHECK (role IS NULL OR role IN ('head_chef','sous_chef','server','bartender','photographer','videographer','sound_engineer','lighting_tech','stage_manager','decorator','driver','security','assistant','floor_manager','other')),
  phone               text        CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  email               citext      CHECK (email IS NULL OR (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254)),
  hourly_rate         numeric(10,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  currency_code       varchar(3)  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  notes               text        CHECK (notes IS NULL OR length(notes) <= 4000),
  status              text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  deactivated_at      timestamptz,
  deactivated_reason  text        CHECK (deactivated_reason IS NULL OR length(deactivated_reason) <= 1000),
  added_at            timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CHECK ((hourly_rate IS NULL) = (currency_code IS NULL)),
  CHECK (status <> 'inactive' OR deactivated_at IS NOT NULL)
);

CREATE INDEX idx_vendor_crew         ON vendor_crew_members (vendor_account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_crew_active  ON vendor_crew_members (vendor_account_id, role) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX idx_vendor_crew_phone   ON vendor_crew_members (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_vendor_crew_email   ON vendor_crew_members (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_vendor_crew_name    ON vendor_crew_members (vendor_account_id, lower(full_name)) WHERE deleted_at IS NULL;

ALTER TABLE vendor_crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_crew_members FORCE ROW LEVEL SECURITY;
