DROP TRIGGER IF EXISTS ae_evt_payment_allocation_insert;

CREATE TRIGGER IF NOT EXISTS ae_evt_payment_allocation_insert
AFTER INSERT ON payment_allocations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM payments p
  WHERE p.id=NEW.payment_id AND p.organization_id=NEW.organization_id AND p.status='posted'
)
BEGIN
  INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
  VALUES(
    'aev_'||lower(hex(randomblob(12))),NEW.organization_id,'finance.payment_allocated','finance',NEW.id,
    'document',NEW.document_id,
    json_object('paymentId',NEW.payment_id,'documentId',NEW.document_id,'amountMinor',NEW.amount_minor),
    CURRENT_TIMESTAMP
  );
END;

CREATE TRIGGER IF NOT EXISTS ae_evt_payment_posted
AFTER UPDATE OF status ON payments
FOR EACH ROW
WHEN NEW.status='posted' AND OLD.status<>'posted'
BEGIN
  INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
  SELECT
    'aev_'||lower(hex(randomblob(12))),a.organization_id,'finance.payment_allocated','finance',a.id,
    'document',a.document_id,
    json_object('paymentId',a.payment_id,'documentId',a.document_id,'amountMinor',a.amount_minor),
    CURRENT_TIMESTAMP
  FROM payment_allocations a
  WHERE a.payment_id=NEW.id AND a.organization_id=NEW.organization_id
    AND NOT EXISTS (
      SELECT 1 FROM ae_event_inbox e
      WHERE e.organization_id=a.organization_id AND e.event_type='finance.payment_allocated' AND e.source_record_id=a.id
    );
END;

CREATE TRIGGER IF NOT EXISTS ae_evt_books_distribution
AFTER INSERT ON bks_distributions
FOR EACH ROW
WHEN NEW.reversed_at IS NULL
BEGIN
  INSERT INTO ae_event_inbox(id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
  VALUES(
    'aev_'||lower(hex(randomblob(12))),NEW.organization_id,'books.stock_changed','books','distribution:'||NEW.id,
    'book_type',NEW.book_type,
    json_object('bookType',NEW.book_type,'quantityDistributed',NEW.quantity),
    CURRENT_TIMESTAMP
  );
END;
