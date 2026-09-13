ALTER TABLE payroll_runs ADD COLUMN reversal_journal_id text REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE payroll_runs ADD COLUMN reversed_by text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payroll_runs ADD COLUMN reversed_at timestamptz;
ALTER TABLE payroll_runs ADD COLUMN reversal_reason text;
CREATE UNIQUE INDEX payroll_run_reversal_journal_unique_idx ON payroll_runs(organization_id,reversal_journal_id) WHERE reversal_journal_id IS NOT NULL;
