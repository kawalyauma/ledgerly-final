CREATE TABLE school_transport_vehicles (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  registration_number text NOT NULL,
  make text,
  model text,
  capacity integer NOT NULL CHECK (capacity > 0),
  driver_staff_id text REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  conductor_staff_id text REFERENCES school_staff_profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive','retired')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code),
  UNIQUE (organization_id,registration_number)
);

CREATE TABLE school_transport_routes (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  vehicle_id text REFERENCES school_transport_vehicles(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'both' CHECK (direction IN ('pickup','dropoff','both')),
  starts_at time,
  ends_at time,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,code)
);

CREATE TABLE school_transport_stops (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_id text NOT NULL REFERENCES school_transport_routes(id) ON DELETE CASCADE,
  name text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  pickup_time time,
  dropoff_time time,
  latitude numeric(10,7),
  longitude numeric(10,7),
  notes text,
  UNIQUE (organization_id,route_id,sequence)
);

CREATE TABLE school_transport_assignments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  route_id text NOT NULL REFERENCES school_transport_routes(id) ON DELETE RESTRICT,
  pickup_stop_id text REFERENCES school_transport_stops(id) ON DELETE SET NULL,
  dropoff_stop_id text REFERENCES school_transport_stops(id) ON DELETE SET NULL,
  academic_year_id text REFERENCES school_academic_years(id) ON DELETE SET NULL,
  term_id text REFERENCES school_terms(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ends_on date,
  notes text,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX school_transport_assignment_active_idx ON school_transport_assignments(organization_id,student_id) WHERE status='active';

CREATE TABLE school_transport_trip_logs (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_id text NOT NULL REFERENCES school_transport_routes(id) ON DELETE RESTRICT,
  vehicle_id text REFERENCES school_transport_vehicles(id) ON DELETE SET NULL,
  trip_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('pickup','dropoff')),
  started_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE school_transport_trip_students (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trip_id text NOT NULL REFERENCES school_transport_trip_logs(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES school_students(id) ON DELETE CASCADE,
  boarded_at timestamptz,
  alighted_at timestamptz,
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','boarded','alighted','absent')),
  remarks text,
  UNIQUE (organization_id,trip_id,student_id)
);

CREATE INDEX school_transport_routes_org_idx ON school_transport_routes(organization_id,active);
CREATE INDEX school_transport_assignments_route_idx ON school_transport_assignments(organization_id,route_id,status);
CREATE INDEX school_transport_trips_date_idx ON school_transport_trip_logs(organization_id,trip_date DESC);
