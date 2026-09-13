CREATE TABLE school_library_titles (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  isbn text,
  title text NOT NULL,
  author text,
  publisher text,
  publication_year integer,
  category text,
  subject_id text REFERENCES school_subjects(id) ON DELETE SET NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,isbn)
);
CREATE INDEX school_library_titles_search_idx ON school_library_titles(organization_id,title,author);

CREATE TABLE school_library_copies (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES school_library_titles(id) ON DELETE CASCADE,
  accession_number text NOT NULL,
  barcode text,
  shelf_location text,
  acquired_on date,
  acquisition_cost_minor bigint NOT NULL DEFAULT 0 CHECK (acquisition_cost_minor >= 0),
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','poor','damaged')),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','loaned','lost','damaged','maintenance','retired')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,accession_number),
  UNIQUE (organization_id,barcode)
);
CREATE INDEX school_library_copies_status_idx ON school_library_copies(organization_id,status,title_id);

CREATE TABLE school_library_loans (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  copy_id text NOT NULL REFERENCES school_library_copies(id) ON DELETE RESTRICT,
  borrower_type text NOT NULL CHECK (borrower_type IN ('student','staff')),
  student_id text REFERENCES school_students(id) ON DELETE SET NULL,
  staff_id text REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  due_on date NOT NULL,
  returned_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','returned','overdue','lost')),
  return_condition text CHECK (return_condition IS NULL OR return_condition IN ('good','fair','poor','damaged','lost')),
  issued_by text REFERENCES users(id) ON DELETE SET NULL,
  returned_by text REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((borrower_type='student' AND student_id IS NOT NULL AND staff_id IS NULL) OR (borrower_type='staff' AND staff_id IS NOT NULL AND student_id IS NULL))
);
CREATE UNIQUE INDEX school_library_active_copy_loan_uq ON school_library_loans(organization_id,copy_id) WHERE status IN ('active','overdue');
CREATE INDEX school_library_borrower_loans_idx ON school_library_loans(organization_id,student_id,staff_id,status,due_on);

CREATE TABLE school_library_reservations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title_id text NOT NULL REFERENCES school_library_titles(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','ready','fulfilled','cancelled','expired')),
  reserved_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz,
  fulfilled_loan_id text REFERENCES school_library_loans(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (organization_id,title_id,student_id,status)
);
CREATE INDEX school_library_reservations_idx ON school_library_reservations(organization_id,title_id,status,reserved_at);

CREATE TABLE school_library_fines (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  loan_id text NOT NULL REFERENCES school_library_loans(id) ON DELETE CASCADE,
  student_id text REFERENCES school_students(id) ON DELETE SET NULL,
  staff_id text REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  reason text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  paid_minor bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','waived')),
  waived_reason text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  settled_by text REFERENCES users(id) ON DELETE SET NULL,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_library_fines_idx ON school_library_fines(organization_id,status,student_id,staff_id);
