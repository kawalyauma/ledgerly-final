CREATE OR REPLACE FUNCTION ledgerly_recompute_school_fee_installments(p_organization_id text,p_document_id text) RETURNS void AS $$
DECLARE
  paid_total bigint;
  remaining bigint;
  rec record;
  applied bigint;
BEGIN
  SELECT COALESCE(paid_minor,0) INTO paid_total
    FROM documents
    WHERE id=p_document_id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RETURN; END IF;
  remaining := paid_total;

  FOR rec IN
    SELECT i.id,i.amount_minor,i.due_date
    FROM school_fee_installments i
    JOIN school_fee_installment_plans p ON p.id=i.plan_id AND p.organization_id=i.organization_id
    WHERE i.organization_id=p_organization_id
      AND p.document_id=p_document_id
      AND p.status<>'cancelled'
    ORDER BY i.due_date,i.sequence,i.id
  LOOP
    applied := LEAST(rec.amount_minor,GREATEST(remaining,0));
    remaining := GREATEST(remaining-applied,0);
    UPDATE school_fee_installments
       SET paid_minor=applied,
           status=CASE
             WHEN applied>=rec.amount_minor THEN 'paid'
             WHEN applied>0 THEN 'partially_paid'
             WHEN rec.due_date<CURRENT_DATE THEN 'overdue'
             ELSE 'pending'
           END,
           updated_at=CURRENT_TIMESTAMP
     WHERE id=rec.id AND organization_id=p_organization_id;
  END LOOP;

  UPDATE school_fee_installment_plans p
     SET status=CASE
       WHEN p.status='cancelled' THEN 'cancelled'
       WHEN NOT EXISTS(
         SELECT 1 FROM school_fee_installments i
         WHERE i.organization_id=p.organization_id AND i.plan_id=p.id AND i.status<>'paid'
       ) THEN 'completed'
       ELSE 'active'
     END,
     updated_at=CURRENT_TIMESTAMP
   WHERE p.organization_id=p_organization_id
     AND p.document_id=p_document_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ledgerly_sync_school_fee_installments_after_document() RETURNS trigger AS $$
BEGIN
  IF NEW.paid_minor IS DISTINCT FROM OLD.paid_minor OR NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM ledgerly_recompute_school_fee_installments(NEW.organization_id,NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS school_fee_installments_document_sync ON documents;
CREATE TRIGGER school_fee_installments_document_sync
AFTER UPDATE OF paid_minor,status ON documents
FOR EACH ROW EXECUTE FUNCTION ledgerly_sync_school_fee_installments_after_document();

UPDATE school_fee_installments i
SET status=CASE
  WHEN i.paid_minor>=i.amount_minor THEN 'paid'
  WHEN i.paid_minor>0 THEN 'partially_paid'
  WHEN i.due_date<CURRENT_DATE THEN 'overdue'
  ELSE 'pending'
END,
updated_at=CURRENT_TIMESTAMP
WHERE i.status<>'cancelled';
