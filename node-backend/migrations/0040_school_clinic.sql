CREATE TABLE school_student_medical_profiles (
  student_id text PRIMARY KEY REFERENCES school_students(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  blood_group text,
  allergies text,
  chronic_conditions text,
  disabilities text,
  dietary_requirements text,
  emergency_notes text,
  primary_doctor_name text,
  primary_doctor_phone text,
  insurance_provider text,
  insurance_number text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_medical_profiles_org_idx ON school_student_medical_profiles(organization_id,student_id);

CREATE TABLE school_clinic_visits (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  visit_number text NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  complaint text NOT NULL,
  symptoms text,
  diagnosis text,
  treatment text,
  disposition text NOT NULL DEFAULT 'returned_to_class' CHECK (disposition IN ('returned_to_class','rested','sent_home','referred','admitted','emergency')),
  temperature_c numeric(4,1),
  weight_kg numeric(6,2),
  height_cm numeric(6,2),
  pulse_bpm integer,
  systolic_bp integer,
  diastolic_bp integer,
  oxygen_saturation integer,
  guardian_notified boolean NOT NULL DEFAULT false,
  guardian_notified_at timestamptz,
  attended_by text REFERENCES users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,visit_number)
);
CREATE INDEX school_clinic_visits_student_idx ON school_clinic_visits(organization_id,student_id,visited_at DESC);

CREATE TABLE school_clinic_medications (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id text NOT NULL REFERENCES school_clinic_visits(id) ON DELETE CASCADE,
  medication_name text NOT NULL,
  dose text,
  route text,
  frequency text,
  quantity text,
  administered_at timestamptz,
  instructions text,
  administered_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE school_student_immunizations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  vaccine_name text NOT NULL,
  dose_number text,
  administered_on date NOT NULL,
  next_due_on date,
  provider text,
  batch_number text,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX school_immunizations_student_idx ON school_student_immunizations(organization_id,student_id,administered_on DESC);

CREATE TABLE school_clinic_referrals (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id text NOT NULL REFERENCES school_clinic_visits(id) ON DELETE CASCADE,
  facility_name text NOT NULL,
  reason text NOT NULL,
  referred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status text NOT NULL DEFAULT 'referred' CHECK (status IN ('referred','attended','completed','cancelled')),
  outcome text,
  follow_up_on date,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
