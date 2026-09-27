-- Per-organization sidebar layout (which module sections show, and in what order).
-- NULL means "new school default" (Dashboard, School, Examinations). Organizations that
-- already exist keep seeing every section until an administrator changes the layout.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS navigation_settings jsonb;
UPDATE organizations SET navigation_settings = '{"showAll":true}'::jsonb WHERE navigation_settings IS NULL;
