-- Phase 2 Unit 8: tenant_custom_domains (spec 3.7).
-- White-label custom domains. State machine:
--   pending_dns -> dns_verified -> pending_approval -> active
-- revoked is terminal.

CREATE TABLE tenant_custom_domains (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  domain             text        NOT NULL UNIQUE CHECK (
                                   length(domain) BETWEEN 4 AND 253
                                   AND domain = lower(domain)
                                   AND domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
                                 ),
  purpose            text        NOT NULL CHECK (purpose IN ('shortlinks','website','both')),
  cname_target       text        NOT NULL CHECK (length(trim(cname_target)) > 0),
  dns_verified_at    timestamptz,
  approved_by        uuid        REFERENCES super_admins (id) ON DELETE SET NULL,
  approved_at        timestamptz,
  ssl_provisioned_at timestamptz,
  status             text        NOT NULL DEFAULT 'pending_dns' CHECK (status IN (
                                   'pending_dns','dns_verified','pending_approval','active','revoked'
                                 )),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'dns_verified'     OR dns_verified_at IS NOT NULL),
  CHECK (status <> 'pending_approval' OR dns_verified_at IS NOT NULL),
  CHECK (status <> 'active'           OR (dns_verified_at IS NOT NULL AND approved_at IS NOT NULL AND ssl_provisioned_at IS NOT NULL AND approved_by IS NOT NULL)),
  CHECK ((approved_at IS NULL) = (approved_by IS NULL))
);

CREATE INDEX idx_tcd_tenant      ON tenant_custom_domains (tenant_id);
CREATE INDEX idx_tcd_status      ON tenant_custom_domains (status);
CREATE INDEX idx_tcd_approved_by ON tenant_custom_domains (approved_by) WHERE approved_by IS NOT NULL;

ALTER TABLE tenant_custom_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_custom_domains FORCE ROW LEVEL SECURITY;
