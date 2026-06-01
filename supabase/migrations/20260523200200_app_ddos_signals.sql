-- Phase 2 Unit 41: app_ddos_signals (spec 19.7).
-- App-layer DDoS / abuse signal log. bigserial PK because volume can
-- be very high. blocked/duration coupled. Worker feeds detections
-- into Cloudflare WAF rules.

CREATE TABLE app_ddos_signals (
  id                     bigserial   PRIMARY KEY,
  signal_type            text        NOT NULL CHECK (signal_type IN (
                                       'rate_burst','pattern_attack','enumeration_attack',
                                       'slow_loris','credential_stuffing','api_abuse'
                                     )),
  ip_address             inet,
  ip_country             varchar(2)  CHECK (ip_country IS NULL OR ip_country ~ '^[A-Z]{2}$'),
  tenant_id              uuid        REFERENCES tenants (id) ON DELETE SET NULL,
  endpoint               text        CHECK (endpoint IS NULL OR length(trim(endpoint)) BETWEEN 1 AND 500),
  http_method            text        CHECK (http_method IS NULL OR http_method IN ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS')),
  count                  integer     NOT NULL CHECK (count >= 1),
  window_seconds         integer     CHECK (window_seconds IS NULL OR window_seconds BETWEEN 1 AND 86400),
  user_agent             text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  detected_at            timestamptz NOT NULL DEFAULT now(),
  blocked                boolean     NOT NULL DEFAULT FALSE,
  block_duration_seconds integer     CHECK (block_duration_seconds IS NULL OR block_duration_seconds BETWEEN 1 AND 31536000),
  notes                  text        CHECK (notes IS NULL OR length(notes) <= 2000),
  CHECK ((blocked = FALSE AND block_duration_seconds IS NULL)
      OR (blocked = TRUE  AND block_duration_seconds IS NOT NULL))
);

CREATE INDEX idx_ddos_signals_ip       ON app_ddos_signals (ip_address, detected_at);
CREATE INDEX idx_ddos_signals_tenant   ON app_ddos_signals (tenant_id, detected_at);
CREATE INDEX idx_ddos_signals_type     ON app_ddos_signals (signal_type, detected_at);
CREATE INDEX idx_ddos_signals_endpoint ON app_ddos_signals (endpoint, detected_at) WHERE endpoint IS NOT NULL;
CREATE INDEX idx_ddos_signals_blocked  ON app_ddos_signals (detected_at) WHERE blocked;

ALTER TABLE app_ddos_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_ddos_signals FORCE ROW LEVEL SECURITY;
