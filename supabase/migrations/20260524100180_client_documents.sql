-- Phase 3 Unit 36: client_documents (spec line 1955).
-- Pro+ inline e-signature documents - contracts, invoices,
-- quotes, agreements, consent_forms, releases. Backed by
-- DocuSign, Signwell, or internal signing rail.
--
-- Status state machine:
--   draft -> sent -> viewed -> signed
--                 -> declined
--                 -> expired
--                 -> voided (any sent state can be voided)
--
-- Per-state prereq CHECKs (5 row-state coupling + 2
-- envelope/provider gating):
--   sent     : sent_at AND client_account_id NOT NULL
--   viewed   : adds viewed_at NOT NULL
--   signed   : adds signed_at AND signed_r2_key NOT NULL
--   declined : adds declined_at AND declined_reason NOT NULL
--   voided   : voided_at AND voided_reason AND voided_by NOT NULL
-- And:
--   any non-draft state requires signature_provider
--   any state where the gateway is involved (sent/viewed/
--   signed/declined) requires signature_envelope_id
--
-- file_size cap 100 MiB (signed contracts can be PDFs).
-- file_hash_sha256 regex matches lowercase 64-hex.
-- signature_audit_trail jsonb shape-checked and <512 KiB
-- (DocuSign certificate of completion JSON).
--
-- Three-way tenant-match trigger: event + created_by member +
-- voided_by member all belong to the document's tenant.

CREATE TABLE client_documents (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id               uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  client_account_id      uuid        REFERENCES client_accounts(id) ON DELETE SET NULL,
  document_type          text        NOT NULL CHECK (document_type IN ('contract','invoice','quote','agreement','consent_form','release')),
  document_name          text        NOT NULL CHECK (length(trim(document_name)) BETWEEN 1 AND 300),
  r2_key                 text        NOT NULL CHECK (length(r2_key) BETWEEN 1 AND 1024),
  signed_r2_key          text        CHECK (signed_r2_key IS NULL OR length(signed_r2_key) BETWEEN 1 AND 1024),
  file_size_bytes        bigint      CHECK (file_size_bytes IS NULL OR (file_size_bytes > 0 AND file_size_bytes <= 104857600)),
  file_hash_sha256       text        CHECK (file_hash_sha256 IS NULL OR file_hash_sha256 ~ '^[a-f0-9]{64}$'),
  signature_provider     text        CHECK (signature_provider IS NULL OR signature_provider IN ('docusign','signwell','internal')),
  signature_envelope_id  text        CHECK (signature_envelope_id IS NULL OR length(signature_envelope_id) BETWEEN 1 AND 200),
  signature_status       text        NOT NULL DEFAULT 'draft' CHECK (signature_status IN ('draft','sent','viewed','signed','declined','expired','voided')),
  sent_at                timestamptz,
  viewed_at              timestamptz,
  signed_at              timestamptz,
  declined_at            timestamptz,
  declined_reason        text        CHECK (declined_reason IS NULL OR length(declined_reason) <= 2000),
  voided_at              timestamptz,
  voided_reason          text        CHECK (voided_reason IS NULL OR length(voided_reason) <= 2000),
  expires_at             timestamptz,
  signature_audit_trail  jsonb       CHECK (signature_audit_trail IS NULL OR (jsonb_typeof(signature_audit_trail) = 'object' AND pg_column_size(signature_audit_trail) < 524288)),
  reminder_count         integer     NOT NULL DEFAULT 0 CHECK (reminder_count BETWEEN 0 AND 50),
  last_reminder_at       timestamptz,
  created_by             uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  voided_by              uuid        REFERENCES tenant_members(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,
  purge_after            timestamptz,
  CHECK (signature_status <> 'sent'     OR (sent_at IS NOT NULL AND client_account_id IS NOT NULL)),
  CHECK (signature_status <> 'viewed'   OR (sent_at IS NOT NULL AND viewed_at IS NOT NULL)),
  CHECK (signature_status <> 'signed'   OR (sent_at IS NOT NULL AND signed_at IS NOT NULL AND signed_r2_key IS NOT NULL)),
  CHECK (signature_status <> 'declined' OR (sent_at IS NOT NULL AND declined_at IS NOT NULL AND declined_reason IS NOT NULL)),
  CHECK (signature_status <> 'voided'   OR (voided_at IS NOT NULL AND voided_reason IS NOT NULL AND voided_by IS NOT NULL)),
  CHECK (signature_status NOT IN ('sent','viewed','signed','declined','expired','voided') OR signature_provider IS NOT NULL),
  CHECK (signature_status NOT IN ('sent','viewed','signed','declined') OR signature_envelope_id IS NOT NULL),
  CHECK (signed_at IS NULL OR (sent_at IS NOT NULL AND signed_at >= sent_at)),
  CHECK (viewed_at IS NULL OR (sent_at IS NOT NULL AND viewed_at >= sent_at)),
  CHECK (declined_at IS NULL OR (sent_at IS NOT NULL AND declined_at >= sent_at)),
  CHECK (expires_at IS NULL OR sent_at IS NULL OR expires_at > sent_at),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX idx_client_docs_client    ON client_documents (client_account_id) WHERE client_account_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_client_docs_event     ON client_documents (event_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_client_docs_tenant    ON client_documents (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_client_docs_status    ON client_documents (signature_status, sent_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_client_docs_envelope  ON client_documents (signature_envelope_id) WHERE signature_envelope_id IS NOT NULL;
CREATE INDEX idx_client_docs_pending   ON client_documents (event_id, sent_at) WHERE signature_status IN ('sent','viewed') AND deleted_at IS NULL;
CREATE INDEX idx_client_docs_expiring  ON client_documents (expires_at) WHERE expires_at IS NOT NULL AND signature_status IN ('sent','viewed');
CREATE INDEX idx_client_docs_creator   ON client_documents (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_client_docs_purge_due ON client_documents (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;

CREATE OR REPLACE FUNCTION client_documents_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; creator_tenant uuid; voider_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL THEN
    RAISE EXCEPTION 'client_documents.event_id % not found', NEW.event_id USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'client_documents.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
  END IF;
  IF NEW.created_by IS NOT NULL THEN
    SELECT tenant_id INTO creator_tenant FROM tenant_members WHERE id = NEW.created_by;
    IF creator_tenant IS NULL OR creator_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'client_documents.created_by % does not belong to tenant %', NEW.created_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.voided_by IS NOT NULL THEN
    SELECT tenant_id INTO voider_tenant FROM tenant_members WHERE id = NEW.voided_by;
    IF voider_tenant IS NULL OR voider_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'client_documents.voided_by % does not belong to tenant %', NEW.voided_by, NEW.tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_client_documents_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, created_by, voided_by ON client_documents
  FOR EACH ROW EXECUTE FUNCTION client_documents_check_tenant_match();

ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_documents FORCE ROW LEVEL SECURITY;
