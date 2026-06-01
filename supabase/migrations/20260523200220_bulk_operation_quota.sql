-- Phase 2 Unit 45: bulk_operation_quota (spec 3.3.2).
-- Per-tenant per-day bulk-op rate limiter. 6 operation types x 3 scopes.
-- scope_id is event_id / tenant_id / user_id depending on scope.
-- count <= limit_value enforced at DB.

CREATE TABLE bulk_operation_quota (
  tenant_id      uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  operation_type text        NOT NULL CHECK (operation_type IN (
                               'guest_import','guest_bulk_delete','email_send','sms_send','export','webhook_deliver'
                             )),
  scope          text        NOT NULL CHECK (scope IN ('per_event','per_workspace','per_user')),
  scope_id       uuid        NOT NULL,
  date           date        NOT NULL,
  count          integer     NOT NULL DEFAULT 0 CHECK (count >= 0),
  limit_value    integer     CHECK (limit_value IS NULL OR limit_value >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, operation_type, scope, scope_id, date),
  CHECK (limit_value IS NULL OR count <= limit_value)
);

CREATE INDEX idx_bulk_quota_date    ON bulk_operation_quota (date);
CREATE INDEX idx_bulk_quota_tenant  ON bulk_operation_quota (tenant_id, date DESC);
CREATE INDEX idx_bulk_quota_op      ON bulk_operation_quota (operation_type, date DESC);
CREATE INDEX idx_bulk_quota_at_cap  ON bulk_operation_quota (tenant_id, date) WHERE limit_value IS NOT NULL AND count >= limit_value;

ALTER TABLE bulk_operation_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_operation_quota FORCE ROW LEVEL SECURITY;
