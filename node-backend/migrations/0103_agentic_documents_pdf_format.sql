-- ae_generated_documents' format CHECK constraint was ported without 'pdf',
-- so every PDF (the most common requested format) failed to save after
-- generation with "violates check constraint ae_generated_documents_format_check".
ALTER TABLE ae_generated_documents DROP CONSTRAINT IF EXISTS ae_generated_documents_format_check;
ALTER TABLE ae_generated_documents ADD CONSTRAINT ae_generated_documents_format_check CHECK (format IN ('pdf','docx','xlsx','pptx'));
