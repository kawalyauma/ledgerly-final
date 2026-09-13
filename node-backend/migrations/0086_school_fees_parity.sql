CREATE TABLE school_fee_awards (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  fee_category_id text REFERENCES school_fee_categories(id) ON DELETE SET NULL,
  award_type text NOT NULL CHECK(award_type IN ('discount','scholarship','bursary','waiver','sibling_discount','other')),
  calculation_type text NOT NULL CHECK(calculation_type IN ('fixed','percentage')),
  amount_minor bigint CHECK(amount_minor IS NULL OR amount_minor>=0),
  rate_micros bigint CHECK(rate_micros IS NULL OR rate_micros BETWEEN 0 AND 100000000),
  reason text,
  starts_on date,
  ends_on date,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_fee_awards_student_idx ON school_fee_awards(organization_id,student_id,active,academic_year_id,term_id);

CREATE TABLE school_fee_installment_plans (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name text NOT NULL,
  total_minor bigint NOT NULL CHECK(total_minor>0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,document_id)
);

CREATE TABLE school_fee_installments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES school_fee_installment_plans(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK(sequence>0),
  due_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  paid_minor bigint NOT NULL DEFAULT 0 CHECK(paid_minor>=0),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','partially_paid','paid','overdue','cancelled')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,plan_id,sequence)
);
CREATE INDEX school_fee_installments_due_idx ON school_fee_installments(organization_id,status,due_date);

ALTER TABLE school_fee_receipts ADD COLUMN IF NOT EXISTS printed_at timestamptz;
ALTER TABLE school_fee_receipts ADD COLUMN IF NOT EXISTS print_count integer NOT NULL DEFAULT 0;
ALTER TABLE school_fee_receipts ADD COLUMN IF NOT EXISTS amount_in_words text;
ALTER TABLE school_fee_receipts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
