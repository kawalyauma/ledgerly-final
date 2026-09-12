CREATE TABLE account_groups (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  parent_group_id text REFERENCES account_groups(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);
CREATE INDEX account_groups_org_type_idx ON account_groups (organization_id,type,code);

CREATE TABLE accounts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  subtype text,
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit','credit')),
  currency text CHECK (currency IS NULL OR char_length(currency)=3),
  allow_posting boolean NOT NULL DEFAULT true,
  parent_account_id text REFERENCES accounts(id) ON DELETE RESTRICT,
  account_group_id text REFERENCES account_groups(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);
CREATE INDEX accounts_org_type_idx ON accounts (organization_id,type,code);
CREATE INDEX accounts_parent_idx ON accounts (organization_id,parent_account_id);
CREATE INDEX accounts_group_idx ON accounts (organization_id,account_group_id);

CREATE TABLE finance_tenant_provisioning (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed')),
  last_error text,
  provisioned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE finance_event_consumptions (
  event_id text NOT NULL REFERENCES backend_outbox_events(id) ON DELETE CASCADE,
  consumer text NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id,consumer)
);

CREATE TABLE finance_journal_sequences (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE journal_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_number text NOT NULL,
  transaction_date date NOT NULL,
  posting_date date NOT NULL,
  description text NOT NULL,
  reference text,
  source_type text NOT NULL DEFAULT 'manual',
  source_id text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  currency text NOT NULL CHECK (char_length(currency)=3),
  exchange_rate_micros bigint NOT NULL DEFAULT 1000000 CHECK (exchange_rate_micros > 0),
  reversal_of_id text REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at timestamptz,
  posted_by text,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,entry_number),
  UNIQUE (organization_id,idempotency_key)
);
CREATE UNIQUE INDEX journal_single_reversal_uq ON journal_entries (organization_id,reversal_of_id) WHERE reversal_of_id IS NOT NULL;
CREATE INDEX journals_org_posting_idx ON journal_entries (organization_id,posting_date DESC,status);
CREATE INDEX journals_source_idx ON journal_entries (organization_id,source_type,source_id);

CREATE TABLE journal_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  journal_entry_id text NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  description text,
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  base_debit_minor bigint NOT NULL DEFAULT 0 CHECK (base_debit_minor >= 0),
  base_credit_minor bigint NOT NULL DEFAULT 0 CHECK (base_credit_minor >= 0),
  contact_id text,
  project_id text,
  class_id text,
  department_id text,
  location_id text,
  tax_code text,
  dimensions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
);
CREATE INDEX journal_lines_entry_idx ON journal_lines (organization_id,journal_entry_id);
CREATE INDEX journal_lines_account_idx ON journal_lines (organization_id,account_id);
CREATE INDEX journal_lines_contact_idx ON journal_lines (organization_id,contact_id);
