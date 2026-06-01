-- Phase 3 Unit 18: guest_refresh_tokens (spec 6.2).
-- Guest-portal session refresh token with rotation + family
-- reuse detection. Each refresh issues a new token that points
-- at the previous one via replaced_by; revoking any token in a
-- family fans out to revoke the rest (app-side after the spec's
-- "revoked-token reuse -> entire family revoked" rule).
--
-- Token hash is UNIQUE (no two live tokens share a hash).
-- expires_at capped at +90 days (spec mentions event-day / 7d /
-- 30d configurable; 90 is the absolute upper bound). Two-way
-- coupling on revoked_at <-> revoked_reason. replaced_by may
-- only be set on a revoked token (rotation discipline).

CREATE TABLE guest_refresh_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id        uuid        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  family_id       uuid        NOT NULL,
  token_hash      text        NOT NULL CHECK (length(token_hash) BETWEEN 32 AND 200),
  replaced_by     uuid        REFERENCES guest_refresh_tokens(id) ON DELETE SET NULL,
  ip_address      inet,
  user_agent      text        CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoked_reason  text        CHECK (revoked_reason IS NULL OR revoked_reason IN ('rotated','logout','reuse_detected','admin','expired','suspended_account')),
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days'),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (last_used_at IS NULL OR last_used_at >= created_at),
  CHECK (replaced_by IS NULL OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX idx_guest_refresh_tokens_hash   ON guest_refresh_tokens (token_hash);
CREATE INDEX idx_guest_refresh_tokens_family        ON guest_refresh_tokens (family_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_guest_refresh_tokens_family_all    ON guest_refresh_tokens (family_id);
CREATE INDEX idx_guest_refresh_tokens_guest         ON guest_refresh_tokens (guest_id);
CREATE INDEX idx_guest_refresh_tokens_event         ON guest_refresh_tokens (event_id);
CREATE INDEX idx_guest_refresh_tokens_tenant        ON guest_refresh_tokens (tenant_id);
CREATE INDEX idx_guest_refresh_tokens_expired_live  ON guest_refresh_tokens (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_guest_refresh_tokens_replaced_by   ON guest_refresh_tokens (replaced_by) WHERE replaced_by IS NOT NULL;

CREATE OR REPLACE FUNCTION guest_refresh_tokens_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; guest_tenant uuid; guest_event uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  SELECT tenant_id, event_id INTO guest_tenant, guest_event FROM guests WHERE id = NEW.guest_id;
  IF event_tenant IS NULL OR guest_tenant IS NULL THEN
    RAISE EXCEPTION 'guest_refresh_tokens parent rows not found' USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id OR guest_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'guest_refresh_tokens.tenant_id % does not match event/guest tenants', NEW.tenant_id USING ERRCODE = '23514';
  END IF;
  IF guest_event <> NEW.event_id THEN
    RAISE EXCEPTION 'guest_refresh_tokens.guest_id % belongs to event %, not %', NEW.guest_id, guest_event, NEW.event_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guest_refresh_tokens_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, guest_id ON guest_refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION guest_refresh_tokens_check_tenant_match();

ALTER TABLE guest_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_refresh_tokens FORCE ROW LEVEL SECURITY;
