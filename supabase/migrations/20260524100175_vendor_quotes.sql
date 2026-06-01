-- Phase 3 Unit 35: vendor_quotes (spec line 2466).
-- Quotes submitted by vendors against their event assignments.
-- Status state machine:
--   draft -> submitted -> tenant_approved -> client_approved
--                       -> tenant_rejected
--                       -> client_rejected
--                       -> expired
--                       -> superseded (a newer quote replaces it)
--
-- Per-state prereq CHECKs:
--   submitted        : submitted_at NOT NULL
--   tenant_approved  : tenant_reviewed_at AND tenant_reviewed_by NOT NULL
--   tenant_rejected  : adds tenant_review_notes NOT NULL
--   client_approved  : adds shared_with_client_at AND client_responded_at
--   client_rejected  : adds client_response_notes
--   expired          : expires_at NOT NULL (or already submitted)
--   superseded       : superseded_by NOT NULL
--
-- amount NOT NULL because zero-quote drafts still need a number.
-- currency_code NOT NULL with ISO 4217 regex. line_items jsonb
-- accepts either array (line-by-line) or object (categorized)
-- shape, capped 512 KiB. document_url HTTPS only.
--
-- Cycle prevention on superseded_by via recursive CTE so an
-- attacker can't build A->B->A supersede loops. Cross-tenant
-- trigger validates event + vendor_assignment (tenant + event
-- + vendor must all match the row) + tenant_reviewed_by member.

CREATE TABLE vendor_quotes (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id              uuid          NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vendor_assignment_id  uuid          NOT NULL REFERENCES vendor_event_assignments(id) ON DELETE CASCADE,
  vendor_account_id     uuid          NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  amount                numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency_code         varchar(3)    NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  line_items            jsonb         CHECK (line_items IS NULL OR (jsonb_typeof(line_items) IN ('array','object') AND pg_column_size(line_items) < 524288)),
  notes                 text          CHECK (notes IS NULL OR length(notes) <= 8000),
  document_url          text          CHECK (document_url IS NULL OR (document_url ~ '^https://' AND length(document_url) BETWEEN 1 AND 2048)),
  status                text          NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','tenant_approved','tenant_rejected','client_approved','client_rejected','expired','superseded')),
  submitted_at          timestamptz,
  tenant_reviewed_at    timestamptz,
  tenant_reviewed_by    uuid          REFERENCES tenant_members(id) ON DELETE SET NULL,
  tenant_review_notes   text          CHECK (tenant_review_notes IS NULL OR length(tenant_review_notes) <= 4000),
  shared_with_client_at timestamptz,
  client_account_id     uuid          REFERENCES client_accounts(id) ON DELETE SET NULL,
  client_responded_at   timestamptz,
  client_response_notes text          CHECK (client_response_notes IS NULL OR length(client_response_notes) <= 4000),
  expires_at            timestamptz,
  superseded_by         uuid          REFERENCES vendor_quotes(id) ON DELETE SET NULL,
  version               integer       NOT NULL DEFAULT 1 CHECK (version >= 1),
  deleted_at            timestamptz,
  purge_after           timestamptz,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT no_self_supersede CHECK (id <> superseded_by),
  CHECK (status <> 'submitted'        OR submitted_at IS NOT NULL),
  CHECK (status <> 'tenant_approved'  OR (tenant_reviewed_at IS NOT NULL AND tenant_reviewed_by IS NOT NULL)),
  CHECK (status <> 'tenant_rejected'  OR (tenant_reviewed_at IS NOT NULL AND tenant_reviewed_by IS NOT NULL AND tenant_review_notes IS NOT NULL)),
  CHECK (status <> 'client_approved'  OR (tenant_reviewed_at IS NOT NULL AND shared_with_client_at IS NOT NULL AND client_responded_at IS NOT NULL)),
  CHECK (status <> 'client_rejected'  OR (tenant_reviewed_at IS NOT NULL AND shared_with_client_at IS NOT NULL AND client_responded_at IS NOT NULL AND client_response_notes IS NOT NULL)),
  CHECK (status <> 'expired'          OR (expires_at IS NOT NULL AND expires_at <= now() OR submitted_at IS NOT NULL)),
  CHECK (status <> 'superseded'       OR superseded_by IS NOT NULL),
  CHECK (expires_at IS NULL OR submitted_at IS NULL OR expires_at > submitted_at),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_vendor_quotes_assignment   ON vendor_quotes (vendor_assignment_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_quotes_status_time  ON vendor_quotes (status, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_quotes_event        ON vendor_quotes (event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_quotes_tenant       ON vendor_quotes (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_quotes_vendor       ON vendor_quotes (vendor_account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_quotes_client       ON vendor_quotes (client_account_id) WHERE client_account_id IS NOT NULL;
CREATE INDEX idx_vendor_quotes_reviewer     ON vendor_quotes (tenant_reviewed_by) WHERE tenant_reviewed_by IS NOT NULL;
CREATE INDEX idx_vendor_quotes_superseded   ON vendor_quotes (superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX idx_vendor_quotes_expiring     ON vendor_quotes (expires_at) WHERE expires_at IS NOT NULL AND status IN ('submitted','tenant_approved');

CREATE OR REPLACE FUNCTION prevent_vendor_quote_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.superseded_by IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE chain AS (
      SELECT id, superseded_by FROM vendor_quotes WHERE id = NEW.superseded_by
      UNION ALL
      SELECT q.id, q.superseded_by FROM vendor_quotes q JOIN chain c ON q.id = c.superseded_by
    ) SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'vendor_quotes superseded_by cycle detected via quote %', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_quotes_cycle_check
  BEFORE INSERT OR UPDATE OF superseded_by ON vendor_quotes
  FOR EACH ROW EXECUTE FUNCTION prevent_vendor_quote_cycle();

CREATE OR REPLACE FUNCTION vendor_quotes_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; ass_tenant uuid; ass_event uuid; ass_vendor uuid;
        reviewer_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'vendor_quotes.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'vendor_quotes.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  SELECT tenant_id, event_id, vendor_account_id INTO ass_tenant, ass_event, ass_vendor FROM vendor_event_assignments WHERE id = NEW.vendor_assignment_id;
  IF ass_tenant IS NULL THEN
    RAISE EXCEPTION 'vendor_quotes.vendor_assignment_id % not found', NEW.vendor_assignment_id USING ERRCODE = '23503';
  END IF;
  IF ass_tenant <> NEW.tenant_id OR ass_event <> NEW.event_id OR ass_vendor <> NEW.vendor_account_id THEN
    RAISE EXCEPTION 'vendor_quotes.vendor_assignment_id % does not match tenant/event/vendor', NEW.vendor_assignment_id USING ERRCODE = '23514';
  END IF;
  IF NEW.tenant_reviewed_by IS NOT NULL THEN
    SELECT tenant_id INTO reviewer_tenant FROM tenant_members WHERE id = NEW.tenant_reviewed_by;
    IF reviewer_tenant IS NULL OR reviewer_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'vendor_quotes.tenant_reviewed_by % does not belong to tenant %', NEW.tenant_reviewed_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_quotes_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, vendor_assignment_id, vendor_account_id, tenant_reviewed_by ON vendor_quotes
  FOR EACH ROW EXECUTE FUNCTION vendor_quotes_check_tenant_match();

ALTER TABLE vendor_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_quotes FORCE ROW LEVEL SECURITY;
