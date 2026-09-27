-- Make existing school fee invoices and allocated receipts visible to the
-- student-dimension based fee statements and reports.

UPDATE journal_lines AS line
SET dimensions_json = COALESCE(line.dimensions_json,'{}'::jsonb)
  || jsonb_build_object('schoolStudentId',doc.custom_fields->>'schoolStudentId')
FROM journal_entries AS entry
JOIN documents AS doc
  ON doc.id=entry.source_id
 AND doc.organization_id=entry.organization_id
JOIN accounts AS account
  ON account.organization_id=entry.organization_id
WHERE line.journal_entry_id=entry.id
  AND line.organization_id=entry.organization_id
  AND line.account_id=account.id
  AND account.subtype IN ('receivable','school_fee_receivable')
  AND doc.custom_fields ? 'schoolStudentId'
  AND COALESCE(line.dimensions_json->>'schoolStudentId','')='';

UPDATE journal_lines AS line
SET dimensions_json = COALESCE(line.dimensions_json,'{}'::jsonb)
  || jsonb_build_object('schoolStudentId',receipt.student_id)
FROM journal_entries AS entry
JOIN school_fee_receipts AS receipt
  ON receipt.payment_id=entry.source_id
 AND receipt.organization_id=entry.organization_id
JOIN accounts AS account
  ON account.organization_id=entry.organization_id
WHERE line.journal_entry_id=entry.id
  AND line.organization_id=entry.organization_id
  AND line.account_id=account.id
  AND account.subtype IN ('receivable','school_fee_receivable')
  AND COALESCE(line.dimensions_json->>'schoolStudentId','')='';
