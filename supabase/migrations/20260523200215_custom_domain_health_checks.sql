-- Phase 2 Unit 44: custom_domain_health_checks (spec 19.11).
-- Daily subdomain-takeover scanner log. bigserial PK because every
-- active custom domain produces ~4 rows per day. SET NULL on tenant_id
-- so the audit trail survives tenant deletion - especially relevant
-- for orphaned-CNAME detection.

CREATE TABLE custom_domain_health_checks (
  id              bigserial   PRIMARY KEY,
  domain          text        NOT NULL CHECK (
                                length(domain) BETWEEN 4 AND 253
                                AND domain = lower(domain)
                                AND domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
                              ),
  tenant_id       uuid        REFERENCES tenants (id) ON DELETE SET NULL,
  check_type      text        NOT NULL CHECK (check_type IN ('cname_intact','ssl_valid','content_served','orphaned')),
  status          text        NOT NULL CHECK (status IN ('healthy','warning','critical','orphaned')),
  observed_target text        CHECK (observed_target IS NULL OR length(trim(observed_target)) BETWEEN 1 AND 500),
  http_status     integer     CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  latency_ms      integer     CHECK (latency_ms IS NULL OR latency_ms >= 0),
  ssl_expires_at  timestamptz,
  notes           text        CHECK (notes IS NULL OR length(notes) <= 2000),
  checked_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'orphaned' OR check_type = 'orphaned')
);

CREATE INDEX idx_domain_health_domain     ON custom_domain_health_checks (domain, checked_at DESC);
CREATE INDEX idx_domain_health_tenant     ON custom_domain_health_checks (tenant_id, checked_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_domain_health_status     ON custom_domain_health_checks (status, checked_at DESC);
CREATE INDEX idx_domain_health_orphaned   ON custom_domain_health_checks (domain, checked_at DESC) WHERE status = 'orphaned';
CREATE INDEX idx_domain_health_ssl_expiry ON custom_domain_health_checks (ssl_expires_at) WHERE ssl_expires_at IS NOT NULL AND check_type = 'ssl_valid';

ALTER TABLE custom_domain_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_domain_health_checks FORCE ROW LEVEL SECURITY;
