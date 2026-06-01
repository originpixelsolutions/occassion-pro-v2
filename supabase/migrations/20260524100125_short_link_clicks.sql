-- Phase 3 Unit 25: short_link_clicks (spec lines 1672-1683).
-- High-volume click log for short_links. bigserial PK chosen
-- over uuid because:
--   - clicks are inserted on every redirect (potentially
--     billions of rows per tenant over time)
--   - bigserial gives sequential physical locality for the
--     time-series access pattern (link_id, clicked_at DESC)
--   - uuid would waste 8 bytes per row and fragment the heap
--
-- Append-only: a BEFORE UPDATE trigger raises an exception so
-- no column can be mutated after insert. DELETE is permitted
-- (R2 cold-storage archive sweeps and tenant offboarding).
--
-- Enums: device_type (mobile/tablet/desktop/bot/other),
-- outcome (success/password_required/password_failed/expired/
-- inactive/not_found/rate_limited) - lets the analytics layer
-- distinguish 'visited' from 'tried but failed gate' without
-- a second table.
--
-- country_code ISO-3166-1 alpha-2, region_code 1-8 chars
-- (covers ISO-3166-2 subdivision codes like 'US-CA' truncated).
--
-- Tenant-match trigger validates clicks.tenant_id =
-- short_links.tenant_id so clicks can never be attributed to
-- the wrong tenant even with valid link IDs.

CREATE TABLE short_link_clicks (
  id            bigserial   PRIMARY KEY,
  link_id       uuid        NOT NULL REFERENCES short_links(id) ON DELETE CASCADE,
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  clicked_at    timestamptz NOT NULL DEFAULT now(),
  ip_address    inet,
  user_agent    text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  device_type   text        CHECK (device_type IS NULL OR device_type IN ('mobile','tablet','desktop','bot','other')),
  os_family     text        CHECK (os_family IS NULL OR length(os_family) <= 60),
  browser_family text       CHECK (browser_family IS NULL OR length(browser_family) <= 60),
  referrer      text        CHECK (referrer IS NULL OR length(referrer) <= 2048),
  country_code  varchar(2)  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  region_code   varchar(8)  CHECK (region_code IS NULL OR length(region_code) BETWEEN 1 AND 8),
  city          text        CHECK (city IS NULL OR length(city) BETWEEN 1 AND 120),
  outcome       text        NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','password_required','password_failed','expired','inactive','not_found','rate_limited'))
);

CREATE INDEX idx_short_link_clicks_link    ON short_link_clicks (link_id, clicked_at DESC);
CREATE INDEX idx_short_link_clicks_tenant  ON short_link_clicks (tenant_id, clicked_at DESC);
CREATE INDEX idx_short_link_clicks_country ON short_link_clicks (country_code, clicked_at DESC) WHERE country_code IS NOT NULL;
CREATE INDEX idx_short_link_clicks_outcome ON short_link_clicks (link_id, outcome) WHERE outcome <> 'success';

CREATE OR REPLACE FUNCTION short_link_clicks_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE link_tenant uuid;
BEGIN
  SELECT tenant_id INTO link_tenant FROM short_links WHERE id = NEW.link_id;
  IF link_tenant IS NULL THEN
    RAISE EXCEPTION 'short_link_clicks.link_id % not found', NEW.link_id USING ERRCODE = '23503';
  END IF;
  IF link_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'short_link_clicks.tenant_id % does not match link tenant %', NEW.tenant_id, link_tenant USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_short_link_clicks_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, link_id ON short_link_clicks
  FOR EACH ROW EXECUTE FUNCTION short_link_clicks_check_tenant_match();

CREATE OR REPLACE FUNCTION short_link_clicks_block_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'short_link_clicks is append-only; UPDATE forbidden' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER trg_short_link_clicks_no_update
  BEFORE UPDATE ON short_link_clicks
  FOR EACH ROW EXECUTE FUNCTION short_link_clicks_block_update();

ALTER TABLE short_link_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE short_link_clicks FORCE ROW LEVEL SECURITY;
