CREATE TABLE school_files (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 text NOT NULL,
  purpose text NOT NULL DEFAULT 'document',
  uploaded_by text REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,object_key)
);
CREATE INDEX school_files_lookup_idx ON school_files(organization_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX school_files_checksum_idx ON school_files(organization_id,checksum_sha256) WHERE deleted_at IS NULL;

CREATE TABLE school_student_documents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  file_id text NOT NULL REFERENCES school_files(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  title text NOT NULL,
  issued_on date,
  expires_on date,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,student_id,file_id)
);
CREATE INDEX school_student_documents_idx ON school_student_documents(organization_id,student_id,document_type);

CREATE TABLE school_staff_documents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_id text NOT NULL REFERENCES school_staff_profiles(id) ON DELETE CASCADE,
  file_id text NOT NULL REFERENCES school_files(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  title text NOT NULL,
  issued_on date,
  expires_on date,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,staff_id,file_id)
);
CREATE INDEX school_staff_documents_idx ON school_staff_documents(organization_id,staff_id,document_type);
