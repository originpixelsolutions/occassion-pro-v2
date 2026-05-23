-- 0016_brand_impersonation_alerts | Phase 1 | spec 19.10
CREATE TABLE brand_impersonation_alerts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_domain   text        NOT NULL CHECK (length(trim(detected_domain)) > 0),
  similarity_score  numeric(3,2) CHECK (similarity_score IS NULL OR (similarity_score BETWEEN 0 AND 1)),
  detected_via      text        NOT NULL CHECK (detected_via IN (
                                  'certificate_transparency','domain_registration','search_crawl','user_report'
                                )),
  status            text        NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new','investigating','confirmed_malicious','false_positive','taken_down')),
  takedown_filed_at timestamptz,
  takedown_provider text,
  taken_down_at     timestamptz,
  notes             text,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'taken_down' OR taken_down_at IS NOT NULL)
);
CREATE INDEX idx_brand_impersonation_status       ON brand_impersonation_alerts (status);
CREATE INDEX idx_brand_impersonation_detected_at  ON brand_impersonation_alerts (detected_at DESC);
ALTER TABLE brand_impersonation_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_impersonation_alerts FORCE ROW LEVEL SECURITY;
