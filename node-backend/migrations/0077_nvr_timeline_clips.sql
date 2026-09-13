CREATE TABLE nvr_event_recording_links (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES nvr_events(id) ON DELETE CASCADE,
  recording_id text NOT NULL REFERENCES nvr_recordings(id) ON DELETE CASCADE,
  clip_start_at timestamptz,
  clip_end_at timestamptz,
  link_reason text NOT NULL DEFAULT 'event-window',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,event_id,recording_id)
);
CREATE INDEX nvr_event_recording_links_event_idx ON nvr_event_recording_links(organization_id,event_id,created_at DESC);
CREATE INDEX nvr_event_recording_links_recording_idx ON nvr_event_recording_links(organization_id,recording_id,created_at DESC);
