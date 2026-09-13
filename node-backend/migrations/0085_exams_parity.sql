ALTER TABLE exm_grade_bands ADD COLUMN IF NOT EXISTS color_hex text NOT NULL DEFAULT '#64748B';
ALTER TABLE exm_grade_bands ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS exm_grade_bands_scale_sort_idx ON exm_grade_bands(organization_id,grading_scale_id,sort_order);
