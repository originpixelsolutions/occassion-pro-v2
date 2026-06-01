-- Phase 4 Unit 43: vendor_portfolios (spec line 2118).
-- Public-style vendor profile shown to tenants during vendor
-- selection. PK = vendor_account_id (one portfolio per
-- vendor). Row presence is the portfolio.
--
-- Array caps: 30 service_categories, 50 service_regions, 20
-- gallery_image_urls (spec mandated). jsonb caps: 16 KiB
-- social_links, 64 KiB awards, 64 KiB certifications.
-- jsonb_typeof gates shape - social_links must be an object,
-- awards/certifications may be either object OR array.
--
-- starting_price paired with starting_currency via two-way
-- coupling CHECK. avg_performance_rating + total_ratings_count
-- are coupled: an average requires at least one rating; zero
-- ratings means no average.
--
-- slug is a globally UNIQUE vanity URL for public discovery
-- (visibility='public'). Optional - the vendor opts in.
-- visibility enum: private (default) / tenants_only / public.
--
-- is_verified is the platform verification flag (set by
-- super_admins). Requires verified_at AND verified_by NOT
-- NULL when set. cover_image_url HTTPS only.
--
-- Two GIN indexes on the array columns power category/region
-- discovery. Partial indexes filter out 'private' rows from
-- the public-discovery paths.

CREATE TABLE vendor_portfolios (
  vendor_account_id      uuid          PRIMARY KEY REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  about_text             text          CHECK (about_text IS NULL OR length(about_text) <= 16384),
  service_categories     text[]        CHECK (service_categories IS NULL OR (array_length(service_categories, 1) IS NULL OR array_length(service_categories, 1) <= 30)),
  service_regions        text[]        CHECK (service_regions IS NULL OR (array_length(service_regions, 1) IS NULL OR array_length(service_regions, 1) <= 50)),
  starting_price         numeric(14,2) CHECK (starting_price IS NULL OR starting_price >= 0),
  starting_currency      varchar(3)    CHECK (starting_currency IS NULL OR starting_currency ~ '^[A-Z]{3}$'),
  years_in_business      integer       CHECK (years_in_business IS NULL OR (years_in_business >= 0 AND years_in_business <= 200)),
  total_events_served    integer       NOT NULL DEFAULT 0 CHECK (total_events_served >= 0),
  avg_performance_rating numeric(3,2)  CHECK (avg_performance_rating IS NULL OR (avg_performance_rating >= 1.0 AND avg_performance_rating <= 5.0)),
  total_ratings_count    integer       NOT NULL DEFAULT 0 CHECK (total_ratings_count >= 0),
  cover_image_url        text          CHECK (cover_image_url IS NULL OR (cover_image_url ~ '^https://' AND length(cover_image_url) BETWEEN 1 AND 2048)),
  gallery_image_urls     text[]        CHECK (gallery_image_urls IS NULL OR (array_length(gallery_image_urls, 1) IS NULL OR array_length(gallery_image_urls, 1) <= 20)),
  social_links           jsonb         CHECK (social_links IS NULL OR (jsonb_typeof(social_links) = 'object' AND pg_column_size(social_links) <= 16384)),
  awards                 jsonb         CHECK (awards IS NULL OR (jsonb_typeof(awards) IN ('array','object') AND pg_column_size(awards) <= 65536)),
  certifications         jsonb         CHECK (certifications IS NULL OR (jsonb_typeof(certifications) IN ('array','object') AND pg_column_size(certifications) <= 65536)),
  slug                   text          UNIQUE CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  visibility             text          NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','tenants_only','public')),
  is_verified            boolean       NOT NULL DEFAULT FALSE,
  verified_at            timestamptz,
  verified_by            uuid          REFERENCES super_admins(id) ON DELETE SET NULL,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now(),
  CHECK ((starting_price IS NULL) = (starting_currency IS NULL)),
  CHECK ((avg_performance_rating IS NULL AND total_ratings_count = 0) OR (avg_performance_rating IS NOT NULL AND total_ratings_count > 0)),
  CHECK (NOT is_verified OR (verified_at IS NOT NULL AND verified_by IS NOT NULL))
);

CREATE INDEX idx_vendor_portfolios_visibility ON vendor_portfolios (visibility) WHERE visibility <> 'private';
CREATE INDEX idx_vendor_portfolios_categories ON vendor_portfolios USING GIN (service_categories) WHERE service_categories IS NOT NULL;
CREATE INDEX idx_vendor_portfolios_regions    ON vendor_portfolios USING GIN (service_regions) WHERE service_regions IS NOT NULL;
CREATE INDEX idx_vendor_portfolios_rating     ON vendor_portfolios (avg_performance_rating DESC) WHERE avg_performance_rating IS NOT NULL AND visibility <> 'private';
CREATE INDEX idx_vendor_portfolios_verified   ON vendor_portfolios (verified_at DESC) WHERE is_verified = TRUE;

ALTER TABLE vendor_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_portfolios FORCE ROW LEVEL SECURITY;
