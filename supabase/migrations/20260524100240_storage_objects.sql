-- Phase 7 Unit 48: storage_objects (spec 18.1 line 3127).
-- R2 object catalog with per-tenant quota tracking.
-- 21-value category enum spans every artefact the platform
-- emits or accepts (logos, avatars, event media, exports,
-- portal docs, presentations, contracts, etc).
--
-- r2_key UNIQUE globally so the R2 bucket is the source of
-- truth; regex enforces alnum + . _ - / (no spaces, no
-- shell-special chars). mime_type regex matches RFC 6838
-- type/subtype. size_bytes capped at 10 GiB (per object).
--
-- storage_class enum (standard, infrequent_access, archive,
-- deep_archive) supports tiered storage. Archival lifecycle:
--   archived_at + archive_destination must couple
--   restored_at requires a prior archive
--   archive_expires_at must be AFTER archived_at
--
-- uploaded_by + uploaded_by_type is the polymorphic actor:
-- type narrows to tenant_member / client / vendor / guest /
-- speaker / system / super_admin; the id is intentionally
-- not FK-enforced because it points at six different parent
-- tables.
--
-- content_hash_sha256 captures the canonical lowercase 64-hex
-- sha-256 for dedup and integrity verification.
--
-- Cross-tenant trigger asserts event.tenant_id matches when
-- event_id is set.

CREATE TABLE storage_objects (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            uuid        REFERENCES events(id) ON DELETE SET NULL,
  category            text        NOT NULL CHECK (category IN (
                        'logo','tenant_avatar','user_avatar','event_cover',
                        'event_photo','event_video','document','export',
                        'vendor_doc','client_doc','invitation_media','speaker_photo','speaker_presentation',
                        'crew_doc','inventory_image','signed_contract','badge_pdf','floor_plan_export','runsheet_export','report','other'
                      )),
  r2_key              text        NOT NULL UNIQUE CHECK (length(r2_key) BETWEEN 1 AND 1024 AND r2_key ~ '^[A-Za-z0-9_./-]+$'),
  r2_bucket           text        NOT NULL DEFAULT 'occasionpro-tenant-storage' CHECK (length(r2_bucket) BETWEEN 1 AND 100),
  filename            text        NOT NULL CHECK (length(trim(filename)) BETWEEN 1 AND 500),
  mime_type           text        NOT NULL CHECK (mime_type ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$' AND length(mime_type) BETWEEN 3 AND 200),
  size_bytes          bigint      NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10737418240),
  content_hash_sha256 text        CHECK (content_hash_sha256 IS NULL OR content_hash_sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by         uuid,
  uploaded_by_type    text        CHECK (uploaded_by_type IS NULL OR uploaded_by_type IN ('tenant_member','client','vendor','guest','speaker','system','super_admin')),
  storage_class       text        NOT NULL DEFAULT 'standard' CHECK (storage_class IN ('standard','infrequent_access','archive','deep_archive')),
  archived_at         timestamptz,
  archive_destination text        CHECK (archive_destination IS NULL OR archive_destination IN ('r2_archive','s3_glacier','b2_archive','wasabi','azure_archive')),
  archive_expires_at  timestamptz,
  restored_at         timestamptz,
  deleted_at          timestamptz,
  purge_after         timestamptz,
  metadata            jsonb       CHECK (metadata IS NULL OR (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) < 16384)),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((archived_at IS NULL AND archive_destination IS NULL AND archive_expires_at IS NULL)
         OR (archived_at IS NOT NULL AND archive_destination IS NOT NULL)),
  CHECK (restored_at IS NULL OR archived_at IS NOT NULL),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL),
  CHECK (archive_expires_at IS NULL OR archived_at IS NULL OR archive_expires_at > archived_at)
);

CREATE INDEX idx_storage_objects_tenant         ON storage_objects (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_storage_objects_event          ON storage_objects (event_id) WHERE event_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_storage_objects_category       ON storage_objects (tenant_id, category) WHERE deleted_at IS NULL;
CREATE INDEX idx_storage_objects_size           ON storage_objects (tenant_id) INCLUDE (size_bytes) WHERE deleted_at IS NULL;
CREATE INDEX idx_storage_archive_pending        ON storage_objects (archive_expires_at) WHERE archived_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_storage_objects_uploader       ON storage_objects (uploaded_by, uploaded_by_type) WHERE uploaded_by IS NOT NULL;
CREATE INDEX idx_storage_objects_purge_due      ON storage_objects (purge_after) WHERE deleted_at IS NOT NULL AND purge_after IS NOT NULL;
CREATE INDEX idx_storage_objects_storage_class  ON storage_objects (tenant_id, storage_class) WHERE deleted_at IS NULL;
CREATE INDEX idx_storage_objects_hash           ON storage_objects (content_hash_sha256) WHERE content_hash_sha256 IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION storage_objects_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
    IF event_tenant IS NULL THEN
      RAISE EXCEPTION 'storage_objects.event_id % not found', NEW.event_id USING ERRCODE = '23503';
    END IF;
    IF event_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'storage_objects.tenant_id % does not match event tenant %', NEW.tenant_id, event_tenant USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_storage_objects_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id ON storage_objects
  FOR EACH ROW EXECUTE FUNCTION storage_objects_check_tenant_match();

ALTER TABLE storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_objects FORCE ROW LEVEL SECURITY;
