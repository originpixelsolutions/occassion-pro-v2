-- Phase 4 Unit 44: vendor_reviews (spec line 2139).
-- Tenant-written reviews of vendors. Powers the verified-
-- reviews surface on the vendor's portfolio (the spec's
-- vendor selection page).
--
-- rating NOT NULL bounded 1.0..5.0 with spec-mandated 1-decimal
-- precision via numeric(2,1). Three optional sub-scores
-- (professionalism, quality, value) using the same bounds.
--
-- review_text capped at 8 KB. vendor_response capped at 4 KB.
-- All three reasons (unpublished, flagged) capped at 1 KB.
--
-- is_verified defaults TRUE because in-platform reviews are
-- automatically verified by the spec. is_published defaults
-- TRUE; unpublished_at and unpublished_reason couple together
-- (an unpublished row requires a reason). vendor_response and
-- vendor_responded_at are two-way coupled.
--
-- Partial UNIQUE (vendor_assignment_id) WHERE NOT deleted:
-- at most one review per vendor assignment (a tenant cannot
-- review the same vendor for the same event twice). Reviews
-- without an assignment (informal/manual entries) are not
-- constrained.
--
-- Four-way consistency trigger: when event_id is set it must
-- belong to reviewer_tenant_id; when vendor_assignment_id is
-- set its (tenant, event, vendor) must match the review's
-- corresponding columns.

CREATE TABLE vendor_reviews (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_account_id     uuid          NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  reviewer_tenant_id    uuid          REFERENCES tenants(id) ON DELETE SET NULL,
  event_id              uuid          REFERENCES events(id) ON DELETE SET NULL,
  vendor_assignment_id  uuid          REFERENCES vendor_event_assignments(id) ON DELETE SET NULL,
  rating                numeric(2,1)  NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
  review_text           text          CHECK (review_text IS NULL OR length(review_text) BETWEEN 1 AND 8000),
  reviewer_name         text          CHECK (reviewer_name IS NULL OR length(trim(reviewer_name)) BETWEEN 1 AND 200),
  service_category      text          CHECK (service_category IS NULL OR length(trim(service_category)) BETWEEN 1 AND 60),
  professionalism_score numeric(2,1)  CHECK (professionalism_score IS NULL OR (professionalism_score >= 1.0 AND professionalism_score <= 5.0)),
  quality_score         numeric(2,1)  CHECK (quality_score IS NULL OR (quality_score >= 1.0 AND quality_score <= 5.0)),
  value_score           numeric(2,1)  CHECK (value_score IS NULL OR (value_score >= 1.0 AND value_score <= 5.0)),
  is_verified           boolean       NOT NULL DEFAULT TRUE,
  is_published          boolean       NOT NULL DEFAULT TRUE,
  unpublished_at        timestamptz,
  unpublished_reason    text          CHECK (unpublished_reason IS NULL OR length(unpublished_reason) <= 1000),
  vendor_response       text          CHECK (vendor_response IS NULL OR length(vendor_response) BETWEEN 1 AND 4000),
  vendor_responded_at   timestamptz,
  flagged_at            timestamptz,
  flagged_reason        text          CHECK (flagged_reason IS NULL OR length(flagged_reason) <= 1000),
  flagged_by            uuid          REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CHECK (NOT is_published OR unpublished_at IS NULL),
  CHECK (unpublished_at IS NULL OR unpublished_reason IS NOT NULL),
  CHECK ((vendor_response IS NULL) = (vendor_responded_at IS NULL)),
  CHECK ((flagged_at IS NULL) = (flagged_reason IS NULL))
);

CREATE UNIQUE INDEX uq_vendor_reviews_assignment
  ON vendor_reviews (vendor_assignment_id) WHERE vendor_assignment_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_vendor_reviews                ON vendor_reviews (vendor_account_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_reviews_published      ON vendor_reviews (vendor_account_id, created_at DESC) WHERE is_published = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_vendor_reviews_event          ON vendor_reviews (event_id) WHERE event_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_vendor_reviews_reviewer       ON vendor_reviews (reviewer_tenant_id) WHERE reviewer_tenant_id IS NOT NULL;
CREATE INDEX idx_vendor_reviews_flagged        ON vendor_reviews (vendor_account_id, flagged_at DESC) WHERE flagged_at IS NOT NULL;
CREATE INDEX idx_vendor_reviews_rating         ON vendor_reviews (vendor_account_id, rating DESC) WHERE is_published = TRUE AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION vendor_reviews_check_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; ass_tenant uuid; ass_event uuid; ass_vendor uuid;
BEGIN
  IF NEW.event_id IS NOT NULL THEN
    SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
    IF event_tenant IS NULL THEN
      RAISE EXCEPTION 'vendor_reviews.event_id % not found', NEW.event_id USING ERRCODE = '23503';
    END IF;
    IF NEW.reviewer_tenant_id IS NOT NULL AND event_tenant <> NEW.reviewer_tenant_id THEN
      RAISE EXCEPTION 'vendor_reviews.event_id belongs to tenant %, not reviewer_tenant_id %', event_tenant, NEW.reviewer_tenant_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.vendor_assignment_id IS NOT NULL THEN
    SELECT tenant_id, event_id, vendor_account_id INTO ass_tenant, ass_event, ass_vendor FROM vendor_event_assignments WHERE id = NEW.vendor_assignment_id;
    IF ass_tenant IS NULL THEN
      RAISE EXCEPTION 'vendor_reviews.vendor_assignment_id % not found', NEW.vendor_assignment_id USING ERRCODE = '23503';
    END IF;
    IF ass_vendor <> NEW.vendor_account_id THEN
      RAISE EXCEPTION 'vendor_reviews.vendor_assignment vendor % does not match review vendor %', ass_vendor, NEW.vendor_account_id USING ERRCODE = '23514';
    END IF;
    IF NEW.reviewer_tenant_id IS NOT NULL AND ass_tenant <> NEW.reviewer_tenant_id THEN
      RAISE EXCEPTION 'vendor_reviews.vendor_assignment tenant % does not match reviewer_tenant_id %', ass_tenant, NEW.reviewer_tenant_id USING ERRCODE = '23514';
    END IF;
    IF NEW.event_id IS NOT NULL AND ass_event <> NEW.event_id THEN
      RAISE EXCEPTION 'vendor_reviews.vendor_assignment event % does not match event_id %', ass_event, NEW.event_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vendor_reviews_consistency
  BEFORE INSERT OR UPDATE OF vendor_account_id, reviewer_tenant_id, event_id, vendor_assignment_id ON vendor_reviews
  FOR EACH ROW EXECUTE FUNCTION vendor_reviews_check_consistency();

ALTER TABLE vendor_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_reviews FORCE ROW LEVEL SECURITY;
