-- Repair PostgreSQL sequence drift after imported/restored mobile sync history.
-- Existing rows can advance change_id without advancing the BIGSERIAL sequence,
-- causing otherwise-valid creates/updates to fail in the mobile sync trigger.
DO $$
DECLARE
  seq_name text;
  next_change_id bigint;
BEGIN
  seq_name := pg_get_serial_sequence('mobile_sync_changes', 'change_id');
  IF seq_name IS NULL THEN
    RAISE EXCEPTION 'mobile_sync_changes.change_id has no PostgreSQL sequence';
  END IF;

  SELECT COALESCE(MAX(change_id), 0) + 1
    INTO next_change_id
    FROM mobile_sync_changes;

  PERFORM setval(seq_name, next_change_id, false);
END
$$;
