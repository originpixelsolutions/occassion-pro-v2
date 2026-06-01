-- Phase 2 Unit 35: revenue_recognition_monthly (spec 3.15).
-- Per-month accrual rows written by RevenueRecognitionWorker.
-- Trigger enforces "sum of monthlies <= parent entry total" so the
-- worker can never over-recognize.

CREATE TABLE revenue_recognition_monthly (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id          uuid          NOT NULL REFERENCES revenue_recognition_entries (id) ON DELETE CASCADE,
  recognition_month date          NOT NULL,
  amount_recognized numeric(14,2) NOT NULL CHECK (amount_recognized > 0),
  recognized_at     timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (entry_id, recognition_month),
  CHECK (recognition_month = date_trunc('month', recognition_month)::date)
);

CREATE INDEX idx_revrec_monthly_month ON revenue_recognition_monthly (recognition_month);
CREATE INDEX idx_revrec_monthly_entry ON revenue_recognition_monthly (entry_id);

ALTER TABLE revenue_recognition_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_recognition_monthly FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION trg_rrm_no_over_recognize() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_total numeric(14,2);
  parent_method text;
  summed numeric(14,2);
BEGIN
  SELECT amount_total, recognition_method
    INTO parent_total, parent_method
    FROM revenue_recognition_entries
   WHERE id = NEW.entry_id;
  SELECT COALESCE(SUM(amount_recognized), 0) INTO summed
    FROM revenue_recognition_monthly
   WHERE entry_id = NEW.entry_id
     AND id <> NEW.id;
  summed := summed + NEW.amount_recognized;
  IF summed > parent_total THEN
    RAISE EXCEPTION 'rrm_over_recognized: sum % > parent total % for entry %',
                    summed, parent_total, NEW.entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rrm_no_over_recognize
BEFORE INSERT OR UPDATE OF amount_recognized, entry_id ON revenue_recognition_monthly
FOR EACH ROW EXECUTE FUNCTION trg_rrm_no_over_recognize();
