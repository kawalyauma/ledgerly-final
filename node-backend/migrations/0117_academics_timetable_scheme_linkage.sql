ALTER TABLE school_academic_timetable_entries
  ADD COLUMN scheme_id text REFERENCES school_schemes_of_work(id) ON DELETE SET NULL,
  ADD COLUMN default_topic_id text REFERENCES school_scheme_topics(id) ON DELETE SET NULL;

CREATE INDEX school_timetable_entries_scheme_idx
  ON school_academic_timetable_entries(organization_id, scheme_id)
  WHERE scheme_id IS NOT NULL;
