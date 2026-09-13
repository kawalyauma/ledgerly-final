CREATE TABLE book_stock_movements (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  book_type text NOT NULL CHECK(book_type IN ('small','a4')),
  quantity_delta integer NOT NULL CHECK(quantity_delta<>0),
  movement_date date NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  reference text,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversed_by text REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX book_stock_movements_idx ON book_stock_movements(organization_id,book_type,movement_date DESC);

CREATE TABLE book_distribution_batches (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  class_id text REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  book_type text NOT NULL CHECK(book_type IN ('small','a4')),
  distributed_on date NOT NULL,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversed_by text REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,batch_number)
);

CREATE TABLE book_distributions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id text REFERENCES book_distribution_batches(id) ON DELETE SET NULL,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  class_id text REFERENCES school_classes(id) ON DELETE SET NULL,
  stream_id text REFERENCES school_streams(id) ON DELETE SET NULL,
  book_type text NOT NULL CHECK(book_type IN ('small','a4')),
  quantity integer NOT NULL CHECK(quantity>0),
  distributed_on date NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversed_by text REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX book_distributions_student_idx ON book_distributions(organization_id,student_id,distributed_on DESC);
CREATE INDEX book_distributions_class_idx ON book_distributions(organization_id,class_id,stream_id,academic_year_id,term_id);
