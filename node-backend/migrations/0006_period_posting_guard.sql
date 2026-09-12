CREATE OR REPLACE FUNCTION ledgerly_guard_journal_posting_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  blocked_name text;
  blocked_status text;
BEGIN
  IF NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted' THEN
    SELECT name,status INTO blocked_name,blocked_status
      FROM fiscal_years
      WHERE organization_id=NEW.organization_id
        AND NEW.posting_date BETWEEN starts_on AND ends_on
        AND status <> 'open'
      ORDER BY starts_on DESC LIMIT 1;
    IF blocked_name IS NOT NULL THEN
      RAISE EXCEPTION 'FISCAL_YEAR_CLOSED:%:%', blocked_name, blocked_status USING ERRCODE='P0001';
    END IF;

    blocked_name := NULL;
    blocked_status := NULL;
    SELECT name,status INTO blocked_name,blocked_status
      FROM fiscal_periods
      WHERE organization_id=NEW.organization_id
        AND NEW.posting_date BETWEEN starts_on AND ends_on
        AND status <> 'open'
      ORDER BY starts_on DESC LIMIT 1;
    IF blocked_name IS NOT NULL THEN
      RAISE EXCEPTION 'FISCAL_PERIOD_CLOSED:%:%', blocked_name, blocked_status USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_posting_period_guard
BEFORE UPDATE OF status ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION ledgerly_guard_journal_posting_period();
