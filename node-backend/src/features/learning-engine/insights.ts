import { z } from "zod";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";
import { createId } from "../core-identity/security.js";
import { enqueueTask, registerTaskHandler } from "./engine.js";

/* ───────────── Teaching timeline: what each class is being taught ───────────── */

export const teachingEventSchema = z.object({
  classId: z.string().min(1).max(160),
  streamId: z.string().max(160).nullish(),
  subjectId: z.string().max(160).nullish(),
  lessonId: z.string().max(160).nullish(),
  teacherStaffId: z.string().max(160).nullish(),
  taughtOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  topic: z.string().trim().min(1).max(300),
  subtopic: z.string().trim().max(300).nullish(),
});

export async function recordTeaching(runtime: Runtime, organizationId: string, userId: string, input: z.infer<typeof teachingEventSchema>) {
  for (const [table, id] of [["school_classes", input.classId], ["school_streams", input.streamId], ["school_subjects", input.subjectId],
    ["lrn_lessons", input.lessonId], ["school_staff_profiles", input.teacherStaffId]] as const) {
    if (id && !(await runtime.db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`, [id, organizationId])).rowCount)
      throw new AppError(404, "NOT_FOUND", "A referenced record was not found in this school");
  }
  const id = createId("ltev");
  const term = await runtime.db.query<{ id: string }>(
    `SELECT id FROM school_terms WHERE organization_id=$1 AND $2::date BETWEEN starts_on AND ends_on ORDER BY is_current DESC LIMIT 1`, [organizationId, input.taughtOn]);
  const row = await runtime.db.query(
    `INSERT INTO lrn_teaching_events(id,organization_id,class_id,stream_id,subject_id,term_id,lesson_id,teacher_staff_id,taught_on,starts_at,ends_at,topic,subtopic,evidence,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'teacher_entry',$14) ON CONFLICT DO NOTHING RETURNING id`,
    [id, organizationId, input.classId, input.streamId ?? null, input.subjectId ?? null, term.rows[0]?.id ?? null, input.lessonId ?? null, input.teacherStaffId ?? null,
      input.taughtOn, input.startsAt ?? null, input.endsAt ?? null, input.topic, input.subtopic ?? null, userId]);
  if (input.lessonId) await runtime.db.query(`UPDATE lrn_lessons SET status='reviewed' WHERE id=$1 AND status='written'`, [input.lessonId]);
  return { id: row.rows[0]?.id ?? null, duplicate: !row.rowCount };
}

/**
 * For every class at a given moment: the timetabled subject now, the latest topic actually taught in each subject
 * (from lesson plan books, exercise books or teacher entries), the matching lesson in the published scheme and the next one.
 */
export async function teachingAt(runtime: Runtime, organizationId: string, input: { date?: string; time?: string; classId?: string }) {
  const clock = await runtime.db.query<{ today: string; now: string }>(
    `SELECT (now() AT TIME ZONE tz)::date::text AS today,to_char(now() AT TIME ZONE tz,'HH24:MI') AS now
       FROM (SELECT COALESCE((SELECT timezone FROM school_profiles WHERE organization_id=$1),'Africa/Kampala') AS tz) z`, [organizationId]);
  const date = input.date ?? clock.rows[0]!.today;
  const time = input.time ?? clock.rows[0]!.now;
  const rows = await runtime.db.query(
    `WITH term AS (SELECT id,starts_on FROM school_terms WHERE organization_id=$1 AND $2::date BETWEEN starts_on AND ends_on ORDER BY is_current DESC LIMIT 1),
     classes AS (SELECT id,name FROM school_classes WHERE organization_id=$1 AND active AND ($4::text IS NULL OR id=$4)),
     now_slot AS (
       SELECT DISTINCT ON (e.class_id) e.class_id,e.subject_id,e.starts_at,e.ends_at,e.teacher_staff_id
         FROM school_academic_timetable_entries e JOIN school_academic_timetables t ON t.id=e.timetable_id
        WHERE e.organization_id=$1 AND t.term_id=(SELECT id FROM term) AND t.status IN ('published','approved')
          AND e.weekday=EXTRACT(ISODOW FROM $2::date) AND $3::time >= e.starts_at AND $3::time < e.ends_at
        ORDER BY e.class_id,CASE t.status WHEN 'published' THEN 0 ELSE 1 END),
     latest AS (
       SELECT DISTINCT ON (ev.class_id,ev.subject_id) ev.class_id,ev.subject_id,ev.topic,ev.subtopic,ev.taught_on,ev.evidence,ev.lesson_id
         FROM lrn_teaching_events ev
        WHERE ev.organization_id=$1 AND ev.taught_on <= $2::date AND ev.taught_on > $2::date - 30
          AND (ev.taught_on < $2::date OR ev.starts_at IS NULL OR ev.starts_at <= $3::time)
        ORDER BY ev.class_id,ev.subject_id,ev.taught_on DESC,ev.starts_at DESC NULLS LAST,ev.created_at DESC)
     SELECT c.id AS "classId",c.name AS "className",
            (SELECT json_build_object('subject',ps.name,'topic',pp.topic,'subtopic',pp.subtopic,'part',pp.lesson_part,'parts',pp.lesson_parts,
                    'startsAt',to_char(pp.starts_at,'HH24:MI'),'endsAt',to_char(pp.ends_at,'HH24:MI'),'status',pp.status,'lessonId',pp.lesson_id)
               FROM lrn_period_plan pp JOIN lrn_timetables tt ON tt.id=pp.timetable_id AND tt.status='published' JOIN school_subjects ps ON ps.id=pp.subject_id
              WHERE pp.organization_id=$1 AND pp.class_id=c.id AND pp.plan_date=$2::date AND $3::time >= pp.starts_at AND $3::time < pp.ends_at LIMIT 1) AS "plannedNow",
            (SELECT json_build_object('subject',ps.name,'topic',pp.topic,'subtopic',pp.subtopic,'part',pp.lesson_part,'parts',pp.lesson_parts,
                    'startsAt',to_char(pp.starts_at,'HH24:MI'),'endsAt',to_char(pp.ends_at,'HH24:MI'),'lessonId',pp.lesson_id)
               FROM lrn_period_plan pp JOIN lrn_timetables tt ON tt.id=pp.timetable_id AND tt.status='published' JOIN school_subjects ps ON ps.id=pp.subject_id
              WHERE pp.organization_id=$1 AND pp.class_id=c.id AND pp.plan_date=$2::date AND pp.starts_at > $3::time ORDER BY pp.starts_at LIMIT 1) AS "plannedNext",
            ns.subject_id AS "nowSubjectId",nsub.name AS "nowSubject",to_char(ns.starts_at,'HH24:MI') AS "nowStarts",to_char(ns.ends_at,'HH24:MI') AS "nowEnds",
            COALESCE(json_agg(json_build_object(
              'subjectId',l.subject_id,'subject',sub.name,'topic',l.topic,'subtopic',l.subtopic,'taughtOn',l.taught_on,'evidence',l.evidence,
              'schemeLesson',m.title,'schemeLessonSeq',m.seq,'nextLesson',nx.title,'nextLessonSeq',nx.seq
            ) ORDER BY sub.name) FILTER (WHERE l.class_id IS NOT NULL),'[]') AS subjects
       FROM classes c
       LEFT JOIN now_slot ns ON ns.class_id=c.id LEFT JOIN school_subjects nsub ON nsub.id=ns.subject_id
       LEFT JOIN latest l ON l.class_id=c.id LEFT JOIN school_subjects sub ON sub.id=l.subject_id
       LEFT JOIN LATERAL (
         SELECT ls.id,ls.seq,ls.title,ls.scheme_id FROM lrn_lessons ls JOIN lrn_schemes sc ON sc.id=ls.scheme_id
          WHERE sc.organization_id=$1 AND sc.class_id=c.id AND sc.subject_id=l.subject_id AND sc.status='published' AND sc.term_id=(SELECT id FROM term)
            AND (ls.id=l.lesson_id OR similarity(lower(concat_ws(' ',ls.title,ls.subtopic)),lower(concat_ws(' ',l.topic,l.subtopic))) > 0.3)
          ORDER BY (ls.id=l.lesson_id) DESC,similarity(lower(concat_ws(' ',ls.title,ls.subtopic)),lower(concat_ws(' ',l.topic,l.subtopic))) DESC LIMIT 1) m ON true
       LEFT JOIN LATERAL (SELECT title,seq FROM lrn_lessons WHERE scheme_id=m.scheme_id AND seq>m.seq ORDER BY seq LIMIT 1) nx ON true
      GROUP BY c.id,c.name,ns.subject_id,nsub.name,ns.starts_at,ns.ends_at
      ORDER BY c.name`, [organizationId, date, time, input.classId ?? null]);
  return { date, time, classes: rows.rows };
}

export async function timeline(runtime: Runtime, organizationId: string, f: { classId: string; subjectId?: string; from?: string; to?: string }) {
  const rows = await runtime.db.query(
    `SELECT ev.id,ev.taught_on::text AS "taughtOn",to_char(ev.starts_at,'HH24:MI') AS "startsAt",ev.topic,ev.subtopic,ev.evidence,ev.confidence,
            ev.subject_id AS "subjectId",s.name AS subject,ev.lesson_id AS "lessonId",ev.capture_page_id AS "capturePageId",
            NULLIF(concat_ws(' ',sp.first_name,sp.last_name),'') AS teacher
       FROM lrn_teaching_events ev LEFT JOIN school_subjects s ON s.id=ev.subject_id LEFT JOIN school_staff_profiles sp ON sp.id=ev.teacher_staff_id
      WHERE ev.organization_id=$1 AND ev.class_id=$2 AND ($3::text IS NULL OR ev.subject_id=$3)
        AND ev.taught_on >= COALESCE($4::date,CURRENT_DATE-90) AND ev.taught_on <= COALESCE($5::date,CURRENT_DATE)
      ORDER BY ev.taught_on DESC,ev.starts_at DESC NULLS LAST LIMIT 500`,
    [organizationId, f.classId, f.subjectId ?? null, f.from ?? null, f.to ?? null]);
  return rows.rows;
}

/** Scheme coverage per subject for a class and term: lessons planned, taught so far, and where the class should be by now. */
export async function coverage(runtime: Runtime, organizationId: string, f: { classId: string; termId?: string }) {
  const rows = await runtime.db.query(
    `WITH term AS (SELECT id,starts_on,ends_on FROM school_terms WHERE organization_id=$1 AND (id=$3 OR ($3::text IS NULL AND is_current)) ORDER BY starts_on DESC LIMIT 1)
     SELECT sc.id AS "schemeId",sc.title,s.name AS subject,sc.periods_per_week AS "periodsPerWeek",count(l.id)::int AS lessons,
            count(DISTINCT l.id) FILTER (WHERE EXISTS (
              SELECT 1 FROM lrn_teaching_events ev WHERE ev.organization_id=$1 AND ev.class_id=sc.class_id AND ev.subject_id=sc.subject_id
                 AND (ev.lesson_id=l.id OR similarity(lower(concat_ws(' ',l.title,l.subtopic)),lower(concat_ws(' ',ev.topic,ev.subtopic))) > 0.3)))::int AS taught,
            LEAST(count(l.id),GREATEST(0,((CURRENT_DATE-(SELECT starts_on FROM term))/7+1))*sc.periods_per_week)::int AS "expectedByNow"
       FROM lrn_schemes sc JOIN school_subjects s ON s.id=sc.subject_id LEFT JOIN lrn_lessons l ON l.scheme_id=sc.id
      WHERE sc.organization_id=$1 AND sc.class_id=$2 AND sc.term_id=(SELECT id FROM term) AND sc.status='published'
      GROUP BY sc.id,s.name ORDER BY s.name`, [organizationId, f.classId, f.termId ?? null]);
  return rows.rows.map((r: Record<string, number>) => ({ ...r, behindBy: Math.max(0, (r.expectedByNow ?? 0) - (r.taught ?? 0)) }));
}

/* ───────────── Learner overview ───────────── */

type Num = number | null;

export async function studentOverview(runtime: Runtime, organizationId: string, studentId: string, f: { subjectId?: string; termId?: string } = {}) {
  const student = await runtime.db.query(
    `SELECT st.id,concat_ws(' ',st.first_name,st.middle_name,st.last_name) AS name,st.admission_number AS "admissionNumber",st.gender,
            st.home_language AS "homeLanguage",c.name AS "className",sr.name AS stream
       FROM school_students st LEFT JOIN school_classes c ON c.id=st.current_class_id LEFT JOIN school_streams sr ON sr.id=st.current_stream_id
      WHERE st.id=$1 AND st.organization_id=$2 AND st.deleted_at IS NULL`, [studentId, organizationId]);
  if (!student.rows[0]) throw new AppError(404, "NOT_FOUND", "Learner not found");
  const termRange = f.termId
    ? (await runtime.db.query<{ from: string; to: string }>(`SELECT starts_on::text AS "from",ends_on::text AS "to" FROM school_terms WHERE id=$1 AND organization_id=$2`, [f.termId, organizationId])).rows[0]
    : undefined;
  const p = [organizationId, studentId, f.subjectId ?? null, termRange?.from ?? null, termRange?.to ?? null];
  const within = (alias: string, col: string) => `${alias}.organization_id=$1 AND ${alias}.student_id=$2 AND ($3::text IS NULL OR ${alias}.subject_id=$3)
    AND ($4::date IS NULL OR ${alias}.${col} >= $4::date) AND ($5::date IS NULL OR ${alias}.${col} <= $5::date)`;
  const [dims, misspellings, grammar, languages, subjects, groups, errors, comments, evidence, summary] = await Promise.all([
    runtime.db.query(
      `SELECT dimension,count(*)::int AS samples,round(avg(rating),1)::float AS average,
              (array_agg(rating ORDER BY observed_on DESC,created_at DESC))[1] AS latest,
              round(avg(rating) FILTER (WHERE rn<=5),1)::float AS "recentAverage",round(avg(rating) FILTER (WHERE rn>5 AND rn<=10),1)::float AS "earlierAverage",
              (array_agg(label ORDER BY observed_on DESC) FILTER (WHERE label IS NOT NULL))[1] AS "latestNote"
         FROM (SELECT o.*,row_number() OVER (PARTITION BY dimension ORDER BY observed_on DESC,created_at DESC) AS rn FROM lrn_student_observations o WHERE ${within("o", "observed_on")}) x
        WHERE dimension<>'teacher_comment' GROUP BY dimension`, p),
    runtime.db.query(
      `SELECT lower(e->>'intended') AS word,array_agg(DISTINCT e->>'written') AS written,count(*)::int AS times
         FROM lrn_student_observations o,jsonb_array_elements(o.details->'errors') e
        WHERE ${within("o", "observed_on")} AND o.dimension='spelling' GROUP BY 1 ORDER BY times DESC,word LIMIT 20`, p),
    runtime.db.query(
      `SELECT g AS issue,count(*)::int AS times FROM lrn_student_observations o,jsonb_array_elements_text(o.details->'grammarIssues') g
        WHERE ${within("o", "observed_on")} AND o.dimension='language' GROUP BY 1 ORDER BY times DESC LIMIT 10`, p),
    runtime.db.query(
      `SELECT o.details->>'language' AS language,count(*)::int AS pages FROM lrn_student_observations o
        WHERE ${within("o", "observed_on")} AND o.dimension='language' AND o.details->>'language' IS NOT NULL GROUP BY 1 ORDER BY pages DESC`, p),
    runtime.db.query(
      `SELECT s.name AS subject,count(*)::int AS attempts,
              round(100.0*sum(CASE a.outcome WHEN 'correct' THEN 1 WHEN 'partial' THEN 0.5 ELSE 0 END)/NULLIF(count(*) FILTER (WHERE a.outcome IN ('correct','partial','incorrect')),0))::int AS "accuracyPct"
         FROM lrn_student_attempts a LEFT JOIN school_subjects s ON s.id=a.subject_id
        WHERE ${within("a", "attempted_on")} GROUP BY s.name ORDER BY s.name`, p),
    runtime.db.query(
      `SELECT g.id AS "groupId",g.label,q.topic,count(*)::int AS attempts,
              avg(CASE a.outcome WHEN 'correct' THEN 1 WHEN 'partial' THEN 0.5 ELSE 0 END)::float AS score,
              avg(CASE a.outcome WHEN 'correct' THEN 1 WHEN 'partial' THEN 0.5 ELSE 0 END) FILTER (WHERE rn<=3)::float AS "recentScore",
              avg(CASE a.outcome WHEN 'correct' THEN 1 WHEN 'partial' THEN 0.5 ELSE 0 END) FILTER (WHERE rn>3)::float AS "earlierScore"
         FROM (SELECT a.*,row_number() OVER (PARTITION BY q2.group_id ORDER BY a.attempted_on DESC,a.created_at DESC) AS rn
                 FROM lrn_student_attempts a JOIN lrn_questions q2 ON q2.id=a.question_id
                WHERE ${within("a", "attempted_on")} AND a.outcome IN ('correct','partial','incorrect')) a
         JOIN lrn_questions q ON q.id=a.question_id JOIN lrn_question_groups g ON g.id=q.group_id
        GROUP BY g.id,g.label,q.topic HAVING count(*)>=2 ORDER BY score`, p),
    runtime.db.query(
      `SELECT error_type AS "errorType",count(*)::int AS times FROM lrn_student_attempts a
        WHERE ${within("a", "attempted_on")} AND a.outcome IN ('incorrect','partial') AND error_type IS NOT NULL AND error_type<>'checked_by_engine'
        GROUP BY 1 ORDER BY times DESC LIMIT 10`, p),
    runtime.db.query(
      `SELECT o.label AS comment,o.observed_on::text AS "observedOn" FROM lrn_student_observations o
        WHERE ${within("o", "observed_on")} AND o.dimension='teacher_comment' ORDER BY o.observed_on DESC LIMIT 8`, p),
    runtime.db.query(
      `SELECT count(DISTINCT p.id)::int AS pages,min(b.captured_on)::text AS "firstScan",max(b.captured_on)::text AS "lastScan",
              (SELECT count(*)::int FROM lrn_student_attempts a WHERE ${within("a", "attempted_on")}) AS answers
         FROM lrn_capture_pages p JOIN lrn_capture_batches b ON b.id=p.batch_id
        WHERE p.organization_id=$1 AND p.student_id=$2 AND ($3::text IS NULL OR b.subject_id=$3)
          AND ($4::date IS NULL OR b.captured_on >= $4::date) AND ($5::date IS NULL OR b.captured_on <= $5::date)`, p),
    runtime.db.query(`SELECT summary,generated_at AS "generatedAt" FROM lrn_student_summaries WHERE organization_id=$1 AND student_id=$2`, [organizationId, studentId]),
  ]);
  const level = (avg: Num) => avg == null ? null : avg >= 4.5 ? "excellent" : avg >= 3.5 ? "good" : avg >= 2.5 ? "fair" : avg >= 1.5 ? "weak" : "very weak";
  const trend = (recent: Num, earlier: Num) => recent == null || earlier == null ? null : recent - earlier >= 0.5 ? "improving" : earlier - recent >= 0.5 ? "declining" : "steady";
  const dimension = (name: string) => {
    const d = dims.rows.find((r: { dimension: string }) => r.dimension === name) as { samples: number; average: Num; latest: Num; recentAverage: Num; earlierAverage: Num; latestNote: string | null } | undefined;
    return d ? { samples: d.samples, rating: d.average, level: level(d.average), latest: d.latest, trend: trend(d.recentAverage, d.earlierAverage), note: d.latestNote } : null;
  };
  type GroupRow = { groupId: string; label: string; topic: string | null; attempts: number; score: number; recentScore: Num; earlierScore: Num };
  const g = groups.rows as GroupRow[];
  const pct = (v: number) => Math.round(v * 100);
  return {
    student: student.rows[0],
    evidence: evidence.rows[0],
    handwriting: dimension("handwriting"),
    spelling: { ...dimension("spelling"), commonMistakes: misspellings.rows },
    language: { ...dimension("language"), languagesWritten: languages.rows, recurringIssues: grammar.rows },
    presentation: dimension("presentation"),
    subjects: subjects.rows,
    weaknesses: g.filter(x => x.score < 0.6).slice(0, 10).map(x => ({ groupId: x.groupId, skill: x.label, topic: x.topic, attempts: x.attempts, scorePct: pct(x.score) })),
    commonErrors: errors.rows,
    achievements: [
      ...g.filter(x => x.score >= 0.8 && x.attempts >= 3).map(x => ({ type: "mastered", skill: x.label, topic: x.topic, attempts: x.attempts, scorePct: pct(x.score) })),
      ...g.filter(x => x.recentScore != null && x.earlierScore != null && x.recentScore - x.earlierScore >= 0.3)
        .map(x => ({ type: "improved", skill: x.label, topic: x.topic, fromPct: pct(x.earlierScore!), toPct: pct(x.recentScore!) })),
    ],
    teacherComments: comments.rows,
    aiSummary: summary.rows[0] ?? null,
  };
}

export async function requestStudentSummary(runtime: Runtime, organizationId: string, userId: string, studentId: string) {
  if (!(await runtime.db.query(`SELECT 1 FROM school_students WHERE id=$1 AND organization_id=$2`, [studentId, organizationId])).rowCount)
    throw new AppError(404, "NOT_FOUND", "Learner not found");
  await enqueueTask(runtime, organizationId, "student.summary", studentId, { priority: 30, requestedBy: userId });
  return { studentId, queued: true };
}

const summaryReply = z.object({ summary: z.string().min(1).max(6000) });

/** AI step: a short narrative of the learner, written strictly from the overview figures. */
registerTaskHandler("student.summary", async (ctx) => {
  const overview = await studentOverview(ctx.runtime, ctx.task.organizationId, ctx.task.subjectRef);
  if (!Number(overview.evidence?.pages ?? 0)) throw new Error("There are no scanned books for this learner yet.");
  const reply = summaryReply.parse(await ctx.ai({
    prompt: [
      "Task: write a short academic overview of this learner for the head teacher and parents (6-10 sentences, plain English).",
      "Cover handwriting, spelling, language, presentation, subject performance, weaknesses with what to practise, and achievements.",
      "Use ONLY the figures in the JSON below; mention how much evidence there is, and say when a dimension has too little evidence.",
      'Reply shape: {"summary":string}',
      "",
      JSON.stringify({ ...overview, aiSummary: undefined }),
    ].join("\n"),
  }));
  await ctx.runtime.db.query(
    `INSERT INTO lrn_student_summaries(organization_id,student_id,summary,evidence_counts,generated_at) VALUES($1,$2,$3,$4::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id,student_id) DO UPDATE SET summary=EXCLUDED.summary,evidence_counts=EXCLUDED.evidence_counts,generated_at=CURRENT_TIMESTAMP`,
    [ctx.task.organizationId, ctx.task.subjectRef, reply.summary, JSON.stringify(overview.evidence ?? {})]);
  return { chars: reply.summary.length };
});
