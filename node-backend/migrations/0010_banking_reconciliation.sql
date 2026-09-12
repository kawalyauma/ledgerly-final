CREATE TABLE bank_accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ledger_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  name text NOT NULL,
  bank_name text,
  account_number_masked text,
  currency text NOT NULL CHECK (char_length(currency)=3),
  opening_balance_minor bigint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,ledger_account_id)
);
CREATE INDEX bank_accounts_org_active_idx ON bank_accounts (organization_id,active,name);

CREATE TABLE bank_statement_imports (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id text NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  filename text NOT NULL,
  statement_start date,
  statement_end date,
  opening_balance_minor bigint,
  closing_balance_minor bigint,
  transaction_count integer NOT NULL DEFAULT 0 CHECK (transaction_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  import_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','reconciled')),
  imported_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,bank_account_id,import_fingerprint)
);
CREATE INDEX bank_statement_imports_account_idx ON bank_statement_imports (organization_id,bank_account_id,created_at DESC);

CREATE TABLE bank_reconciliations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id text NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  statement_date date NOT NULL,
  statement_balance_minor bigint NOT NULL,
  ledger_balance_minor bigint NOT NULL,
  difference_minor bigint NOT NULL,
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  unmatched_count integer NOT NULL DEFAULT 0 CHECK (unmatched_count >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  prepared_by text NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX bank_reconciliations_account_idx ON bank_reconciliations (organization_id,bank_account_id,statement_date DESC);

CREATE TABLE bank_transactions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id text NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  import_id text REFERENCES bank_statement_imports(id) ON DELETE RESTRICT,
  external_id text,
  transaction_date date NOT NULL,
  description text NOT NULL,
  reference text,
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','reconciled')),
  matched_journal_line_id text REFERENCES journal_lines(id) ON DELETE RESTRICT,
  matched_at timestamptz,
  matched_by text,
  reconciliation_id text REFERENCES bank_reconciliations(id) ON DELETE RESTRICT,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX bank_transactions_external_uq ON bank_transactions (organization_id,bank_account_id,external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX bank_transactions_journal_line_uq ON bank_transactions (organization_id,matched_journal_line_id) WHERE matched_journal_line_id IS NOT NULL;
CREATE INDEX bank_transactions_account_date_idx ON bank_transactions (organization_id,bank_account_id,transaction_date DESC,status);
CREATE INDEX bank_transactions_import_idx ON bank_transactions (organization_id,import_id);

CREATE TABLE bank_reconciliation_items (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reconciliation_id text NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
  bank_transaction_id text NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
  journal_line_id text NOT NULL REFERENCES journal_lines(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,reconciliation_id,bank_transaction_id),
  UNIQUE (organization_id,bank_transaction_id)
);

CREATE OR REPLACE FUNCTION ledgerly_validate_bank_transaction_match() RETURNS trigger AS $$
DECLARE
  bank_ledger_id text;
  bank_currency text;
  line_account_id text;
  line_amount bigint;
  journal_currency text;
  journal_status text;
BEGIN
  IF NEW.status='unmatched' THEN
    IF NEW.matched_journal_line_id IS NOT NULL OR NEW.reconciliation_id IS NOT NULL THEN
      RAISE EXCEPTION 'BANK_MATCH_STATE_INVALID:%', NEW.id USING ERRCODE='P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.matched_journal_line_id IS NULL THEN
    RAISE EXCEPTION 'BANK_MATCH_REQUIRED:%', NEW.id USING ERRCODE='P0001';
  END IF;

  SELECT ledger_account_id,currency INTO bank_ledger_id,bank_currency
    FROM bank_accounts WHERE id=NEW.bank_account_id AND organization_id=NEW.organization_id;
  SELECT l.account_id,(l.debit_minor-l.credit_minor),j.currency,j.status
    INTO line_account_id,line_amount,journal_currency,journal_status
    FROM journal_lines l
    JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
    WHERE l.id=NEW.matched_journal_line_id AND l.organization_id=NEW.organization_id;

  IF line_account_id IS NULL OR journal_status <> 'posted' THEN
    RAISE EXCEPTION 'BANK_MATCH_LINE_INVALID:%', NEW.matched_journal_line_id USING ERRCODE='P0001';
  END IF;
  IF line_account_id <> bank_ledger_id THEN
    RAISE EXCEPTION 'BANK_MATCH_ACCOUNT_MISMATCH:%', NEW.matched_journal_line_id USING ERRCODE='P0001';
  END IF;
  IF journal_currency <> bank_currency THEN
    RAISE EXCEPTION 'BANK_MATCH_CURRENCY_MISMATCH:%', NEW.matched_journal_line_id USING ERRCODE='P0001';
  END IF;
  IF line_amount <> NEW.amount_minor THEN
    RAISE EXCEPTION 'BANK_MATCH_AMOUNT_MISMATCH:%', NEW.matched_journal_line_id USING ERRCODE='P0001';
  END IF;
  IF NEW.status='reconciled' AND NEW.reconciliation_id IS NULL THEN
    RAISE EXCEPTION 'BANK_RECONCILIATION_REQUIRED:%', NEW.id USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_transaction_match_guard
BEFORE INSERT OR UPDATE OF status,matched_journal_line_id,reconciliation_id ON bank_transactions
FOR EACH ROW EXECUTE FUNCTION ledgerly_validate_bank_transaction_match();

CREATE OR REPLACE FUNCTION ledgerly_guard_bank_reconciliation() RETURNS trigger AS $$
BEGIN
  IF NEW.status='completed' THEN
    IF NEW.difference_minor <> 0 THEN
      RAISE EXCEPTION 'RECONCILIATION_DIFFERENCE:%', NEW.id USING ERRCODE='P0001';
    END IF;
    IF NEW.unmatched_count <> 0 THEN
      RAISE EXCEPTION 'RECONCILIATION_UNMATCHED_TRANSACTIONS:%', NEW.id USING ERRCODE='P0001';
    END IF;
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := CURRENT_TIMESTAMP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_reconciliation_guard
BEFORE INSERT OR UPDATE OF status,difference_minor,unmatched_count ON bank_reconciliations
FOR EACH ROW EXECUTE FUNCTION ledgerly_guard_bank_reconciliation();
