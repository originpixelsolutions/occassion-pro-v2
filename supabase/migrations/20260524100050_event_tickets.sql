-- Phase 3 Unit 11: event_tickets (spec 9.1).
-- Public-facing ticket types. 10-value ticket_type enum. Capacity
-- invariant: sold + reserved <= total. Late fee couples with the
-- late-window endpoint AND a sale_ends_at. UNIQUE name per active
-- ticket per event. Trigger blocks cross-tenant tickets.

CREATE TABLE event_tickets (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid          NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_id            uuid          NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  ticket_type         text          NOT NULL CHECK (ticket_type IN ('general','vip','early_bird','student','press','staff','complimentary','sponsor','workshop','exhibitor')),
  name                text          NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  description         text          CHECK (description IS NULL OR length(description) <= 4000),
  price               numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency_code       varchar(3)    NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  quantity_total      integer       CHECK (quantity_total IS NULL OR quantity_total >= 0),
  quantity_sold       integer       NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
  quantity_reserved   integer       NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  min_per_order       integer       NOT NULL DEFAULT 1 CHECK (min_per_order >= 1),
  max_per_order       integer       CHECK (max_per_order IS NULL OR max_per_order >= 1),
  sale_starts_at      timestamptz,
  sale_ends_at        timestamptz,
  late_fee            numeric(10,2) CHECK (late_fee IS NULL OR late_fee >= 0),
  late_window_ends_at timestamptz,
  deleted_at          timestamptz,
  purge_after         timestamptz,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  CHECK (quantity_total IS NULL OR quantity_sold + quantity_reserved <= quantity_total),
  CHECK (max_per_order IS NULL OR max_per_order >= min_per_order),
  CHECK (sale_ends_at IS NULL OR sale_starts_at IS NULL OR sale_ends_at > sale_starts_at),
  CHECK ((late_fee IS NULL AND late_window_ends_at IS NULL) OR (late_fee IS NOT NULL AND late_window_ends_at IS NOT NULL AND sale_ends_at IS NOT NULL)),
  CHECK (late_window_ends_at IS NULL OR late_window_ends_at > sale_ends_at),
  CHECK (purge_after IS NULL OR deleted_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_event_tickets_name_active
  ON event_tickets (event_id, lower(name)) WHERE deleted_at IS NULL;

CREATE INDEX idx_event_tickets_event       ON event_tickets (event_id);
CREATE INDEX idx_event_tickets_tenant      ON event_tickets (tenant_id);
CREATE INDEX idx_event_tickets_sale_window ON event_tickets (sale_starts_at, sale_ends_at) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION trg_event_tickets_tenant_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE event_tenant uuid;
BEGIN
  SELECT tenant_id INTO event_tenant FROM events WHERE id = NEW.event_id;
  IF event_tenant IS NULL OR event_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'event_tickets_tenant_mismatch: event tenant (%) <> ticket tenant (%)',
                    event_tenant, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_event_tickets_tenant_match
BEFORE INSERT OR UPDATE OF tenant_id, event_id ON event_tickets
FOR EACH ROW EXECUTE FUNCTION trg_event_tickets_tenant_match();

ALTER TABLE event_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_tickets FORCE ROW LEVEL SECURITY;
