-- Trace every resource considered for a scheme, and keep bad OCR out of curriculum generation.
ALTER TABLE lrn_sources ADD COLUMN IF NOT EXISTS quality_status TEXT NOT NULL DEFAULT 'good'
  CHECK (quality_status IN ('good','warning','unreadable'));
ALTER TABLE lrn_sources ADD COLUMN IF NOT EXISTS quality_issues JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS lrn_scheme_source_audit (
  scheme_id TEXT NOT NULL REFERENCES lrn_schemes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_slug TEXT NOT NULL,
  source_id TEXT REFERENCES lrn_sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('used','skipped','failed')),
  reason TEXT,
  passages INTEGER NOT NULL DEFAULT 0,
  passages_used INTEGER NOT NULL DEFAULT 0,
  quality_status TEXT CHECK (quality_status IN ('good','warning','unreadable')),
  quality_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scheme_id, provider, external_slug)
);
CREATE INDEX IF NOT EXISTS lrn_scheme_source_audit_scheme_idx ON lrn_scheme_source_audit(scheme_id, decision);
