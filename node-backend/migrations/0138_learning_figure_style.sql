-- Figures carry a style. Schools print in black, so new figures are black line art ('line'); the earlier colour
-- drawings stay in the library as 'colour' but are no longer picked for reuse.
ALTER TABLE lrn_figures ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT 'colour';
UPDATE lrn_figures SET style='colour' WHERE style IS NULL;
ALTER TABLE lrn_figures ALTER COLUMN style SET DEFAULT 'line';
