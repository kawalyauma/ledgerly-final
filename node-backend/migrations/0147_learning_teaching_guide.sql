-- The scheme of work lists only the teaching methods; the step-by-step class activities feed the lesson plan.
ALTER TABLE lrn_lessons ADD COLUMN IF NOT EXISTS teaching_guide TEXT;

WITH words(seq, label, pattern) AS (VALUES
  (1, 'Story telling', 'stor(y|ies)'), (2, 'Discussion', 'discuss'), (3, 'Question and answer', 'question'),
  (4, 'Explanation', 'explain|explanation'), (5, 'Guided Bible reading', 'bible'), (6, 'Guided Quran reading', 'qur.?an'),
  (7, 'Group work', 'group'), (8, 'Dramatisation', 'drama|act(s|ing)? out|role.?play'), (9, 'Singing', '\msing|song'),
  (10, 'Demonstration', 'demonstrat'), (11, 'Observation', 'observ'), (12, 'Experiment', 'experiment'),
  (13, 'Drawing', '\mdraw'), (14, 'Brainstorming', 'brainstorm'), (15, 'Field study', 'field|nature walk'),
  (16, 'Games', '\mgames?\M'), (17, 'Guided practice', 'exercise|practi[cs]e'))
UPDATE lrn_lessons l SET teaching_guide = l.methods,
  methods = NULLIF((SELECT string_agg(w.label, ', ' ORDER BY w.seq) FROM words w WHERE l.methods ~* w.pattern), '')
 WHERE l.teaching_guide IS NULL AND length(l.methods) > 150;
