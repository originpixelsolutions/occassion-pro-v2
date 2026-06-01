-- Phase 3 Unit 17: guest_otps (spec 6.2).
-- Multi-channel OTP for guest-portal auth.
-- Primary: WhatsApp/SMS mobile OTP; Fallback: email OTP.
-- 10-min validity per spec; we cap the DB-enforced expiry at
-- 15 min as defense in depth (real expires_at is set by app at
-- 10 min). 5-attempt verify cap is enforced via the attempts
-- column CHECK.
--
-- Two terminal states are mutually exclusive: consumed_at (user
-- entered correct OTP) and invalidated_at (max_attempts hit, or
-- superseded by a fresh OTP, or rotated by a refresh cycle). A
-- two-way coupling CHECK ties invalidated_at to its reason.
--
-- Cross-tenant trigger validates BOTH event AND guest belong to
-- the OTP's tenant and that guest_id belongs to event_id - the
-- spec's strongest binding because attacker-controlled phone
-- numbers can't be used to issue OTPs against arbitrary guests
-- in other tenants/events.

CREATE TABLE guest_otps (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id      uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_id      uuid        NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  channel       text        NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  recipient     text        NOT NULL CHECK (length(trim(recipient)) BETWEEN 1 AND 254),
  otp_hash      text        NOT NULL CHECK (length(otp_hash) BETWEEN 32 AND 200),
  attempts      integer     NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  invalidated_at timestamptz,
  invalidated_reason text   CHECK (invalidated_reason IS NULL OR invalidated_reason IN ('max_attempts','superseded','manual','expired_rotation')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes'),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CHECK ((invalidated_at IS NULL) = (invalidated_reason IS NULL)),
  CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);

CREATE INDEX idx_guest_otps_recipient ON guest_otps (recipient, event_id, expires_at);
CREATE INDEX idx_guest_otps_guest     ON guest_otps (guest_id);
CREATE INDEX idx_guest_otps_event     ON guest_otps (event_id);
CREATE INDEX idx_guest_otps_tenant    ON guest_otps (tenant_id);
CREATE INDEX idx_guest_otps_live      ON guest_otps (event_id, guest_id, channel, created_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE OR REPLACE FUNCTION guest_otps_check_tenant_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid; guest_tenant uuid; guest_event uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  SELECT tenant_id, event_id INTO guest_tenant, guest_event FROM guests WHERE id = NEW.guest_id;
  IF event_tenant IS NULL OR guest_tenant IS NULL THEN
    RAISE EXCEPTION 'guest_otps parent rows not found' USING ERRCODE = '23503';
  END IF;
  IF event_tenant <> NEW.tenant_id OR guest_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'guest_otps.tenant_id % does not match event/guest tenants', NEW.tenant_id USING ERRCODE = '23514';
  END IF;
  IF guest_event <> NEW.event_id THEN
    RAISE EXCEPTION 'guest_otps.guest_id % belongs to event %, not %', NEW.guest_id, guest_event, NEW.event_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guest_otps_tenant_match
  BEFORE INSERT OR UPDATE OF tenant_id, event_id, guest_id ON guest_otps
  FOR EACH ROW EXECUTE FUNCTION guest_otps_check_tenant_match();

ALTER TABLE guest_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_otps FORCE ROW LEVEL SECURITY;
