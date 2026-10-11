-- A lesson.write task now represents one subject-week, not one lesson.
-- Two attempts allow one recovery from a provider/JSON interruption without multiplying usage.
UPDATE lrn_ai_tasks SET max_attempts=LEAST(max_attempts,2)
 WHERE kind='lesson.write' AND status='queued';
