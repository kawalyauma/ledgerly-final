-- General thematic schemes (all learning areas of a lower-primary term) are kept only for the theme and week order.
ALTER TABLE lrn_scheme_sources DROP CONSTRAINT IF EXISTS lrn_scheme_sources_role_check;
ALTER TABLE lrn_scheme_sources ADD CONSTRAINT lrn_scheme_sources_role_check
  CHECK (role IN ('curriculum','scheme','notes','lesson_plans','past_papers','reference','theme'));
