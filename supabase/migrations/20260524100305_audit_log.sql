-- Phase 10 Unit 61: audit_log (spec 16 line 4337, doc Part 16
-- + Part 27 immutable audit trail).
--
-- The immutable platform-wide audit trail. Every
-- security-relevant action on the platform writes here.
-- Triggers across other modules call insert_audit_log() (set
-- up in Phase 11) which fans out into this table.
--
-- *** PARTITIONED BY RANGE (occurred_at), monthly ***
--
-- Append-only, immutable, partitioned, FK-soft. PK is
-- composite (id, occurred_at) - required for partition
-- pruning to work on a bigserial PK.
--
-- Initial four partitions cover 2026-06 through 2026-09. A
-- Phase 11 SQL function maintains the next-12-months window
-- rolling; an Inngest job runs monthly to add/drop partitions
-- and snapshot expired data to cold storage per retention
-- policy.
--
-- 10-value actor_type enum spans every caller identity
-- (super_admin, tenant_member, client, vendor, guest,
-- speaker, system, anonymous, api_key, webhook). actor_id
-- is REQUIRED for human/api_key actors, must be NULL for
-- system actors.
--
-- action regex `domain.verb` enforces the standard naming
-- (e.g. `tenant.created`, `client_event_access.revoked`).
-- resource_type regex enforces snake_case lowercase ASCII.
--
-- 8-value severity enum, 4-value status enum. failure/denied
-- statuses REQUIRE failure_reason (no silent errors).
--
-- source enum tracks how the action originated (app, api,
-- webhook, job, cli, system, migration, seed, impersonation,
-- sso). The (source='impersonation') = (impersonator_id NOT
-- NULL) biconditional CHECK keeps impersonation traceable.
--
-- 4-value retention_class controls long-term retention:
--   standard   - 13 months
--   extended   - 7 years (financial/SOX)
--   permanent  - never deleted (security-critical)
--   sensitive  - encrypted at rest, restricted access
--
-- Append-only enforced by audit_log_immutable_guard() BEFORE
-- UPDATE/DELETE - raises EXCEPTION with errcode 23514. This
-- guarantees no row can be tampered with after creation.
--
-- 9 partial indexes target the audit-search hot paths:
-- tenant timeline, actor timeline, resource timeline, action
-- search, alert-grade severity, correlation chain, request
-- trace, impersonation review, failure analytics.

CREATE TABLE audit_log (
  id              bigserial      NOT NULL,
  occurred_at     timestamptz    NOT NULL DEFAULT now(),
  tenant_id       uuid           REFERENCES tenants(id) ON DELETE SET NULL,
  actor_type      text           NOT NULL CHECK (actor_type IN ('super_admin','tenant_member','client','vendor','guest','speaker','system','anonymous','api_key','webhook')),
  actor_id        uuid,
  actor_label     text           CHECK (actor_label IS NULL OR length(actor_label) BETWEEN 1 AND 300),
  action          text           NOT NULL CHECK (length(action) BETWEEN 1 AND 100 AND action ~ '^[a-z][a-z0-9_.]+\.[a-z][a-z0-9_]+$'),
  resource_type   text           NOT NULL CHECK (length(resource_type) BETWEEN 1 AND 80 AND resource_type ~ '^[a-z][a-z0-9_]+$'),
  resource_id     text           CHECK (resource_id IS NULL OR length(resource_id) BETWEEN 1 AND 200),
  resource_label  text           CHECK (resource_label IS NULL OR length(resource_label) BETWEEN 1 AND 500),
  severity        text           NOT NULL DEFAULT 'info' CHECK (severity IN ('debug','info','notice','warning','error','critical','security','compliance')),
  status          text           NOT NULL DEFAULT 'success' CHECK (status IN ('success','failure','denied','partial')),
  failure_reason  text           CHECK (failure_reason IS NULL OR length(failure_reason) <= 2000),
  request_id      uuid,
  session_id      text           CHECK (session_id IS NULL OR length(session_id) BETWEEN 1 AND 200),
  ip_address      inet,
  user_agent      text           CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  source          text           NOT NULL DEFAULT 'app' CHECK (source IN ('app','api','webhook','job','cli','system','migration','seed','impersonation','sso')),
  changes         jsonb          CHECK (changes IS NULL OR (jsonb_typeof(changes) = 'object' AND pg_column_size(changes) <= 524288)),
  metadata        jsonb          CHECK (metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 65536)),
  correlation_id  uuid,
  impersonator_id uuid,
  retention_class text           NOT NULL DEFAULT 'standard' CHECK (retention_class IN ('standard','extended','permanent','sensitive')),
  created_at      timestamptz    NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('failure','denied') OR failure_reason IS NOT NULL),
  CHECK (actor_type <> 'system' OR actor_id IS NULL),
  CHECK (actor_type NOT IN ('super_admin','tenant_member','client','vendor','guest','speaker','api_key') OR actor_id IS NOT NULL),
  CHECK ((source = 'impersonation') = (impersonator_id IS NOT NULL)),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit_log_2026_06 PARTITION OF audit_log FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
CREATE TABLE audit_log_2026_07 PARTITION OF audit_log FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
CREATE TABLE audit_log_2026_09 PARTITION OF audit_log FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE INDEX idx_audit_log_tenant_occurred ON audit_log (tenant_id, occurred_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_audit_log_actor_occurred  ON audit_log (actor_type, actor_id, occurred_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_log_resource        ON audit_log (resource_type, resource_id, occurred_at DESC) WHERE resource_id IS NOT NULL;
CREATE INDEX idx_audit_log_action          ON audit_log (action, occurred_at DESC);
CREATE INDEX idx_audit_log_severity        ON audit_log (severity, occurred_at DESC) WHERE severity IN ('warning','error','critical','security','compliance');
CREATE INDEX idx_audit_log_correlation     ON audit_log (correlation_id, occurred_at) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_audit_log_request         ON audit_log (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_audit_log_impersonation   ON audit_log (impersonator_id, occurred_at DESC) WHERE impersonator_id IS NOT NULL;
CREATE INDEX idx_audit_log_failures        ON audit_log (occurred_at DESC) WHERE status IN ('failure','denied');

CREATE OR REPLACE FUNCTION audit_log_immutable_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $body$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log is append-only: UPDATE not permitted (id=%)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_log is append-only: DELETE not permitted (id=%)', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$body$;

CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable_guard();
CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable_guard();

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
