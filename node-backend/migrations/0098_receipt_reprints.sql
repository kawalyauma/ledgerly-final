CREATE TABLE prn_receipt_reprints (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id text NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  printerly_document_id text NOT NULL REFERENCES prn_documents(id) ON DELETE RESTRICT,
  printerly_job_id text NOT NULL REFERENCES prn_jobs(id) ON DELETE RESTRICT,
  requested_by text REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','printing','completed','failed')),
  finance_status text NOT NULL DEFAULT 'pending' CHECK(finance_status IN ('pending','posted','not_applicable','failed')),
  finance_journal_id text REFERENCES journal_entries(id) ON DELETE SET NULL,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,printerly_job_id)
);

CREATE INDEX prn_receipt_reprints_payment_idx
  ON prn_receipt_reprints(organization_id,payment_id,created_at DESC);
CREATE INDEX prn_receipt_reprints_status_idx
  ON prn_receipt_reprints(organization_id,status,created_at DESC);
