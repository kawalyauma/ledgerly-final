CREATE TABLE school_fee_categories (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  income_account_id text NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_fee_structures (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  academic_year_id text NOT NULL REFERENCES school_academic_years(id) ON DELETE RESTRICT,
  term_id text REFERENCES school_terms(id) ON DELETE RESTRICT,
  class_level_id text REFERENCES school_class_levels(id) ON DELETE RESTRICT,
  class_id text REFERENCES school_classes(id) ON DELETE RESTRICT,
  stream_id text REFERENCES school_streams(id) ON DELETE RESTRICT,
  residency_status text,
  student_category text,
  currency text NOT NULL DEFAULT 'UGX',
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_fee_structure_lines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  structure_id text NOT NULL REFERENCES school_fee_structures(id) ON DELETE CASCADE,
  fee_category_id text NOT NULL REFERENCES school_fee_categories(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK(amount_minor>=0),
  due_date date,
  mandatory boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_fee_lines_structure_idx ON school_fee_structure_lines(organization_id,structure_id);

CREATE TABLE school_student_fee_charges (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  structure_id text REFERENCES school_fee_structures(id) ON DELETE SET NULL,
  structure_line_id text REFERENCES school_fee_structure_lines(id) ON DELETE SET NULL,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  fee_category_id text REFERENCES school_fee_categories(id) ON DELETE SET NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>=0),
  due_date date,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,student_id,structure_line_id,document_id)
);
CREATE INDEX school_fee_charges_student_idx ON school_student_fee_charges(organization_id,student_id,created_at DESC);

CREATE TABLE school_fee_receipts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  payment_id text NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  receipt_number text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  payment_date date NOT NULL,
  reference text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,receipt_number),
  UNIQUE (organization_id,payment_id)
);
CREATE INDEX school_fee_receipts_student_idx ON school_fee_receipts(organization_id,student_id,payment_date DESC);
