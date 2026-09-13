CREATE TABLE prn_service_desk_settings (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  response_sla_minutes integer NOT NULL DEFAULT 60 CHECK (response_sla_minutes BETWEEN 1 AND 10080),
  resolution_sla_minutes integer NOT NULL DEFAULT 480 CHECK (resolution_sla_minutes BETWEEN 1 AND 43200),
  auto_create_from_critical_alerts boolean NOT NULL DEFAULT true,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prn_service_tickets (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_number text NOT NULL,
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','acknowledged','in_progress','resolved','closed','cancelled')),
  printer_id text REFERENCES prn_printers(id) ON DELETE SET NULL,
  node_id text REFERENCES prn_nodes(id) ON DELETE SET NULL,
  source_alert_id text REFERENCES prn_alerts(id) ON DELETE SET NULL,
  assignee_id text REFERENCES users(id) ON DELETE SET NULL,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  response_due_at timestamptz,
  resolution_due_at timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id,ticket_number)
);
CREATE INDEX prn_service_tickets_org_idx ON prn_service_tickets(organization_id,status,priority,created_at DESC);
CREATE UNIQUE INDEX prn_service_ticket_alert_uq ON prn_service_tickets(organization_id,source_alert_id) WHERE source_alert_id IS NOT NULL AND status NOT IN ('resolved','closed','cancelled');

CREATE TABLE prn_service_ticket_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id text NOT NULL REFERENCES prn_service_tickets(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  notes text,
  actor_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX prn_service_ticket_events_idx ON prn_service_ticket_events(organization_id,ticket_id,created_at);

CREATE TABLE prn_maintenance_windows (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  printer_id text REFERENCES prn_printers(id) ON DELETE CASCADE,
  node_id text REFERENCES prn_nodes(id) ON DELETE CASCADE,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at>starts_at),
  CHECK (printer_id IS NOT NULL OR node_id IS NOT NULL)
);
CREATE INDEX prn_maintenance_windows_org_idx ON prn_maintenance_windows(organization_id,starts_at,ends_at);
