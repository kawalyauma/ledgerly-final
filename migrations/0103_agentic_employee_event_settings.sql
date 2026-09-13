CREATE TABLE IF NOT EXISTS ae_event_settings (
  organization_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  attendance_window_days INTEGER NOT NULL DEFAULT 7,
  attendance_attention_count INTEGER NOT NULL DEFAULT 2,
  attendance_urgent_count INTEGER NOT NULL DEFAULT 3,
  books_low_stock_threshold INTEGER NOT NULL DEFAULT 20,
  payment_reaction_enabled INTEGER NOT NULL DEFAULT 1,
  attendance_reaction_enabled INTEGER NOT NULL DEFAULT 1,
  hr_reaction_enabled INTEGER NOT NULL DEFAULT 1,
  books_reaction_enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
