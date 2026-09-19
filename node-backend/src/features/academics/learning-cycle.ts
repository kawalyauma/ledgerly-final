import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/);
const blankToNull = (value: unknown) => typeof value === "string" && value.trim() === "" ? null : value;
const nullableText = (max = 10000) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const nullableDate = z.preprocess(blankToNull, date.nullable().optional());
const nullableTime = z.preprocess(blankToNull, time.nullable().optional());
const nullableId = z.preprocess(blankToNull, z.string().min(1).nullable().optional());

const schemeCreateSchema = z.object({
  academicYearId: z.string().min(1),
  termId: z.string().min(1),
  classId: z.string().min(1),
  streamId: nullableId,
  subjectId: z.string().min(1),
  teacherStaffId: nullableId,
  curriculumId: nullableId,
  title: z.string().trim().max(300).optional().default("")
});
const topicSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: nullableText(5000),
  weekFrom: z.number().int().positive().nullable().optional(),
  weekTo: z.number().int().positive().nullable().optional(),
  plannedStartOn: nullableDate,
  plannedEndOn: nullableDate
}).superRefine((v, ctx) => {
  if (v.weekFrom && v.weekTo && v.weekTo < v.weekFrom) ctx.addIssue({ code: "custom", path: ["weekTo"], message: "weekTo must be on or after weekFrom" });
  if (v.plannedStartOn && v.plannedEndOn && v.plannedEndOn < v.plannedStartOn) ctx.addIssue({ code: "custom", path: ["plannedEndOn"], message: "plannedEndOn must be on or after plannedStartOn" });
});
const lessonSchema = z.object({
  title: z.string().trim().min(1).max(300),
  subtopic: nullableText(300),
  plannedDate: nullableDate,
  durationMinutes: z.number().int().positive().max(1440).default(40),
  learningOutcomes: nullableText(),
  teachingMethods: nullableText(),
  learningResources: nullableText(),
  learnerActivities: nullableText(),
  assessmentStrategy: nullableText(),
  valuesAndCrossCutting: nullableText()
});
const competencySchema = z.object({
  id: z.string().optional(),
  competencyType: z.string().trim().min(1).max(80),
  code: nullableText(120),
  title: z.string().trim().min(1).max(500),
  description: nullableText(5000),
  successCriteria: nullableText(5000)
});
const competenciesSchema = z.object({ competencies: z.array(competencySchema).max(100) });
const planSchema = z.object({
  lessonDate: date,
  priorKnowledge: nullableText(),
  introductionText: nullableText(),
  lessonDevelopment: nullableText(),
  teacherActivities: nullableText(),
  learnerActivities: nullableText(),
  differentiatedInstruction: nullableText(),
  specialNeedsAccommodations: nullableText(),
  lessonConclusion: nullableText(),
  homework: nullableText()
});
const deliverySchema = z.object({
  taughtOn: date,
  actualStartsAt: nullableTime,
  actualEndsAt: nullableTime,
  lessonNotes: nullableText(),
  teacherReflection: nullableText()
});
const markSchema = z.object({
  studentId: z.string().min(1),
  score: z.number().nonnegative().nullable(),
  absent: z.boolean().default(false),
  competencyLevel: z.enum(["not_assessed", "emerging", "developing", "proficient", "advanced"]).default("not_assessed"),
  remark: nullableText(2000)
});
const assessmentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  assessmentType: z.enum(["formative", "oral", "written", "practical", "observation", "project", "homework", "other"]),
  maxScore: z.number().positive(),
  marks: z.array(markSchema).max(5000)
});
const feedbackSchema = z.object({ feedback: z.string().trim().min(1).max(5000) });
const optionalFeedbackSchema = z.object({ feedback: z.string().trim().max(5000).optional() });

function camel(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
  return out;
}

async function owned(runtime: Runtime, orgId: string, table: string, id?: string | null) {
  if (!id) return;
  const q = await runtime.db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`, [id, orgId]);
  if (!q.rowCount) throw new AppError(422, "INVALID_REFERENCE", `${table} record does not belong to this school`);
}

function validationError(message: string, details?: unknown) {
  return new AppError(422, "VALIDATION_ERROR", message, details);
}

async function getCoverage(runtime: Runtime, orgId: string, schemeId: string) {
  const q = await runtime.db.query(`
    SELECT COUNT(l.id)::int AS lessons,
           COUNT(l.id) FILTER (WHERE l.status IN ('delivered','assessed'))::int AS delivered,
           COUNT(l.id) FILTER (WHERE l.status='assessed')::int AS assessed
    FROM school_scheme_topics t
    LEFT JOIN school_scheme_lessons l ON l.topic_id=t.id AND l.organization_id=$1
    WHERE t.organization_id=$1 AND t.scheme_id=$2
  `, [orgId, schemeId]);
  const lessons = Number(q.rows[0]?.lessons ?? 0);
  const delivered = Number(q.rows[0]?.delivered ?? 0);
  const assessed = Number(q.rows[0]?.assessed ?? 0);
  return { lessons, delivered, assessed, coveragePercent: lessons ? Math.round((delivered / lessons) * 100) : 0 };
}

async function refreshTopicStatus(runtime: Runtime, orgId: string, topicId: string) {
  await runtime.db.query(`
    UPDATE school_scheme_topics t
       SET status = CASE
         WHEN NOT EXISTS (SELECT 1 FROM school_scheme_lessons l WHERE l.organization_id=$1 AND l.topic_id=t.id) THEN 'planned'
         WHEN NOT EXISTS (SELECT 1 FROM school_scheme_lessons l WHERE l.organization_id=$1 AND l.topic_id=t.id AND l.status NOT IN ('delivered','assessed')) THEN 'covered'
         WHEN EXISTS (SELECT 1 FROM school_scheme_lessons l WHERE l.organization_id=$1 AND l.topic_id=t.id AND l.status IN ('delivered','assessed')) THEN 'in_progress'
         ELSE 'planned'
       END,
       updated_at=CURRENT_TIMESTAMP
     WHERE t.id=$2 AND t.organization_id=$1
  `, [orgId, topicId]);
}

async function planContext(runtime: Runtime, orgId: string, planId: string) {
  const q = await runtime.db.query(`
    SELECT p.*,
           l.topic_id,l.title AS lesson_title,l.subtopic,l.learning_outcomes,l.teaching_methods,l.learning_resources,
           l.assessment_strategy,l.values_and_cross_cutting,l.status AS lesson_status,l.planned_date,l.lesson_plan_id,
           t.title AS topic,t.scheme_id,
           s.academic_year_id,s.term_id,s.class_id,s.stream_id,s.subject_id,s.teacher_staff_id,s.status AS scheme_status
      FROM school_scheme_lesson_plans p
      JOIN school_scheme_lessons l ON l.id=p.lesson_id AND l.organization_id=$2
      JOIN school_scheme_topics t ON t.id=l.topic_id AND t.organization_id=$2
      JOIN school_schemes_of_work s ON s.id=t.scheme_id AND s.organization_id=$2
     WHERE p.id=$1 AND p.organization_id=$2
  `, [planId, orgId]);
  if (!q.rowCount) throw new AppError(404, "NOT_FOUND", "Lesson plan not found");
  return q.rows[0] as Record<string, any>;
}

async function lessonContext(runtime: Runtime, orgId: string, lessonId: string) {
  const q = await runtime.db.query(`
    SELECT l.*,t.scheme_id,s.academic_year_id,s.term_id,s.class_id,s.stream_id,s.subject_id,s.status AS scheme_status,
           p.status AS lesson_plan_status
      FROM school_scheme_lessons l
      JOIN school_scheme_topics t ON t.id=l.topic_id AND t.organization_id=$2
      JOIN school_schemes_of_work s ON s.id=t.scheme_id AND s.organization_id=$2
      LEFT JOIN school_scheme_lesson_plans p ON p.id=l.lesson_plan_id AND p.organization_id=$2
     WHERE l.id=$1 AND l.organization_id=$2
  `, [lessonId, orgId]);
  if (!q.rowCount) throw new AppError(404, "NOT_FOUND", "Lesson not found");
  return q.rows[0] as Record<string, any>;
}

async function eligibleLearners(runtime: Runtime, orgId: string, academicYearId: string, classId: string, streamId?: string | null) {
  const q = await runtime.db.query(`
    SELECT DISTINCT s.id,
           TRIM(CONCAT_WS(' ',s.first_name,s.middle_name,s.last_name)) AS name,
           s.admission_number,s.student_number
      FROM school_students s
     WHERE s.organization_id=$1
       AND s.deleted_at IS NULL
       AND (
         EXISTS (
           SELECT 1 FROM school_enrollments e
            WHERE e.organization_id=$1 AND e.student_id=s.id AND e.academic_year_id=$2 AND e.class_id=$3
              AND ($4::text IS NULL OR e.stream_id=$4)
              AND e.status IN ('active','promoted','completed')
         )
         OR (
           s.current_academic_year_id=$2 AND s.current_class_id=$3
           AND ($4::text IS NULL OR s.current_stream_id=$4)
         )
       )
     ORDER BY name,s.id
  `, [orgId, academicYearId, classId, streamId ?? null]);
  return q.rows.map(camel) as Array<Record<string, any>>;
}

async function requireScheme(runtime: Runtime, orgId: string, schemeId: string) {
  const q = await runtime.db.query(`SELECT * FROM school_schemes_of_work WHERE id=$1 AND organization_id=$2`, [schemeId, orgId]);
  if (!q.rowCount) throw new AppError(404, "NOT_FOUND", "Scheme not found");
  return q.rows[0] as Record<string, any>;
}

export function createLearningCycleRoutes(runtime: Runtime) {
  const r = new Hono<AppEnv>();
  r.use("*", requireScope("school:read"));

  r.get("/setup", async c => {
    const p = c.get("principal"), orgId = p.organizationId;
    const [years, terms, classes, streams, subjects, teachers, teacherAllocations] = await Promise.all([
      runtime.db.query(`SELECT * FROM school_academic_years WHERE organization_id=$1 ORDER BY is_current DESC,starts_on DESC`, [orgId]),
      runtime.db.query(`SELECT * FROM school_terms WHERE organization_id=$1 ORDER BY is_current DESC,starts_on DESC,sequence_no`, [orgId]),
      runtime.db.query(`SELECT * FROM school_classes WHERE organization_id=$1 AND active=true ORDER BY name`, [orgId]),
      runtime.db.query(`SELECT * FROM school_streams WHERE organization_id=$1 AND active=true ORDER BY name`, [orgId]),
      runtime.db.query(`SELECT * FROM school_subjects WHERE organization_id=$1 AND active=true ORDER BY name`, [orgId]),
      runtime.db.query(`SELECT id,COALESCE(NULLIF(preferred_name,''),TRIM(CONCAT_WS(' ',first_name,middle_name,last_name))) AS name,staff_number FROM school_staff_profiles WHERE organization_id=$1 AND deleted_at IS NULL AND employment_status='active' AND is_teacher=true ORDER BY name`, [orgId]),
      runtime.db.query(`SELECT id,staff_id AS teacher_staff_id,academic_year_id,term_id,class_id,stream_id,subject_id,periods_per_week FROM school_staff_teaching_assignments WHERE organization_id=$1 AND active=true ORDER BY created_at`, [orgId])
    ]);
    return c.json({ data: {
      years: years.rows.map(camel), terms: terms.rows.map(camel), classes: classes.rows.map(camel), streams: streams.rows.map(camel),
      subjects: subjects.rows.map(camel), teachers: teachers.rows.map(camel), teacherAllocations: teacherAllocations.rows.map(camel)
    }});
  });

  r.get("/learning/schemes", async c => {
    const p = c.get("principal"), orgId = p.organizationId;
    const q = await runtime.db.query(`
      SELECT w.*,sub.name AS subject_name,cl.name AS class_name,st.name AS stream_name,tr.name AS term_name,ay.name AS academic_year_name,
             COALESCE(NULLIF(sp.preferred_name,''),TRIM(CONCAT_WS(' ',sp.first_name,sp.middle_name,sp.last_name))) AS teacher_name,
             (SELECT COUNT(l.id)::int FROM school_scheme_topics t JOIN school_scheme_lessons l ON l.topic_id=t.id AND l.organization_id=w.organization_id WHERE t.organization_id=w.organization_id AND t.scheme_id=w.id) AS lesson_count,
             (SELECT CASE WHEN COUNT(l.id)=0 THEN 0 ELSE ROUND(100.0*COUNT(l.id) FILTER (WHERE l.status IN ('delivered','assessed'))/COUNT(l.id))::int END
                FROM school_scheme_topics t JOIN school_scheme_lessons l ON l.topic_id=t.id AND l.organization_id=w.organization_id
               WHERE t.organization_id=w.organization_id AND t.scheme_id=w.id) AS coverage_percent
        FROM school_schemes_of_work w
        JOIN school_subjects sub ON sub.id=w.subject_id AND sub.organization_id=w.organization_id
        JOIN school_classes cl ON cl.id=w.class_id AND cl.organization_id=w.organization_id
        JOIN school_terms tr ON tr.id=w.term_id AND tr.organization_id=w.organization_id
        JOIN school_academic_years ay ON ay.id=w.academic_year_id AND ay.organization_id=w.organization_id
        LEFT JOIN school_streams st ON st.id=w.stream_id AND st.organization_id=w.organization_id
        LEFT JOIN school_staff_profiles sp ON sp.id=w.teacher_staff_id AND sp.organization_id=w.organization_id
       WHERE w.organization_id=$1
       ORDER BY w.created_at DESC
    `, [orgId]);
    return c.json({ data: q.rows.map(camel) });
  });

  r.post("/learning/schemes", requireScope("school:write"), async c => {
    const parsed = schemeCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError("Invalid scheme", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, v = parsed.data;
    for (const [table, id] of [
      ["school_academic_years", v.academicYearId], ["school_terms", v.termId], ["school_classes", v.classId],
      ["school_streams", v.streamId], ["school_subjects", v.subjectId], ["school_staff_profiles", v.teacherStaffId], ["school_curricula", v.curriculumId]
    ] as const) await owned(runtime, orgId, table, id);
    const refs = await runtime.db.query(`
      SELECT ay.name AS academic_year_name,tr.name AS term_name,cl.name AS class_name,st.name AS stream_name,sub.name AS subject_name,
             tr.academic_year_id AS term_year_id,cl.academic_year_id AS class_year_id,st.class_id AS stream_class_id
        FROM school_academic_years ay
        JOIN school_terms tr ON tr.id=$2 AND tr.organization_id=$1
        JOIN school_classes cl ON cl.id=$3 AND cl.organization_id=$1
        JOIN school_subjects sub ON sub.id=$4 AND sub.organization_id=$1
        LEFT JOIN school_streams st ON st.id=$5 AND st.organization_id=$1
       WHERE ay.id=$6 AND ay.organization_id=$1
    `, [orgId, v.termId, v.classId, v.subjectId, v.streamId ?? null, v.academicYearId]);
    const ref = refs.rows[0];
    if (!ref) throw validationError("Invalid scheme references");
    if (ref.term_year_id !== v.academicYearId) throw validationError("The selected term does not belong to the selected academic year");
    if (ref.class_year_id && ref.class_year_id !== v.academicYearId) throw validationError("The selected class does not belong to the selected academic year");
    if (v.streamId && ref.stream_class_id !== v.classId) throw validationError("The selected stream does not belong to the selected class");
    const title = v.title || `${ref.subject_name} · ${ref.class_name}${ref.stream_name ? ` · ${ref.stream_name}` : ""} · ${ref.term_name}`;
    const id = createId("sch");
    await runtime.db.query(`INSERT INTO school_schemes_of_work(id,organization_id,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_staff_id,curriculum_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, orgId, v.academicYearId, v.termId, v.classId, v.streamId ?? null, v.subjectId, v.teacherStaffId ?? null, v.curriculumId ?? null, title, p.userId]);
    return c.json({ data: { id, academicYearId: v.academicYearId, termId: v.termId, classId: v.classId, streamId: v.streamId ?? null, subjectId: v.subjectId, teacherStaffId: v.teacherStaffId ?? null, curriculumId: v.curriculumId ?? null, title, status: "draft" } }, 201);
  });

  r.get("/learning/schemes/:id", async c => {
    const p = c.get("principal"), orgId = p.organizationId, schemeId = c.req.param("id");
    const q = await runtime.db.query(`
      SELECT w.*,sub.name AS subject_name,cl.name AS class_name,st.name AS stream_name,tr.name AS term_name,ay.name AS academic_year_name,
             COALESCE(NULLIF(sp.preferred_name,''),TRIM(CONCAT_WS(' ',sp.first_name,sp.middle_name,sp.last_name))) AS teacher_name
        FROM school_schemes_of_work w
        JOIN school_subjects sub ON sub.id=w.subject_id AND sub.organization_id=w.organization_id
        JOIN school_classes cl ON cl.id=w.class_id AND cl.organization_id=w.organization_id
        JOIN school_terms tr ON tr.id=w.term_id AND tr.organization_id=w.organization_id
        JOIN school_academic_years ay ON ay.id=w.academic_year_id AND ay.organization_id=w.organization_id
        LEFT JOIN school_streams st ON st.id=w.stream_id AND st.organization_id=w.organization_id
        LEFT JOIN school_staff_profiles sp ON sp.id=w.teacher_staff_id AND sp.organization_id=w.organization_id
       WHERE w.id=$1 AND w.organization_id=$2
    `, [schemeId, orgId]);
    if (!q.rowCount) throw new AppError(404, "NOT_FOUND", "Scheme not found");
    const [topicsQ, lessonsQ, competenciesQ] = await Promise.all([
      runtime.db.query(`SELECT * FROM school_scheme_topics WHERE organization_id=$1 AND scheme_id=$2 ORDER BY COALESCE(week_from,2147483647),created_at,id`, [orgId, schemeId]),
      runtime.db.query(`SELECT l.*,p.status AS lesson_plan_status FROM school_scheme_lessons l JOIN school_scheme_topics t ON t.id=l.topic_id AND t.organization_id=$1 LEFT JOIN school_scheme_lesson_plans p ON p.id=l.lesson_plan_id AND p.organization_id=$1 WHERE l.organization_id=$1 AND t.scheme_id=$2 ORDER BY l.topic_id,l.sequence_no,l.created_at`, [orgId, schemeId]),
      runtime.db.query(`SELECT cp.* FROM school_scheme_lesson_competencies cp JOIN school_scheme_lessons l ON l.id=cp.lesson_id AND l.organization_id=$1 JOIN school_scheme_topics t ON t.id=l.topic_id AND t.organization_id=$1 WHERE cp.organization_id=$1 AND t.scheme_id=$2 ORDER BY cp.lesson_id,cp.id`, [orgId, schemeId])
    ]);
    const competencies = new Map<string, Record<string, unknown>[]>();
    for (const row of competenciesQ.rows) {
      const key = String(row.lesson_id), list = competencies.get(key) ?? [];
      list.push(camel(row)); competencies.set(key, list);
    }
    const lessons = new Map<string, Record<string, unknown>[]>();
    for (const row of lessonsQ.rows) {
      const key = String(row.topic_id), list = lessons.get(key) ?? [], item = camel(row);
      item.competencies = competencies.get(String(row.id)) ?? [];
      list.push(item); lessons.set(key, list);
    }
    const topics = topicsQ.rows.map(row => ({ ...camel(row), lessons: lessons.get(String(row.id)) ?? [] }));
    const allLessons = lessonsQ.rows;
    const lessonCount = allLessons.length;
    const plans = allLessons.filter(x => x.lesson_plan_id).length;
    const delivered = allLessons.filter(x => ["delivered", "assessed"].includes(String(x.status))).length;
    const assessed = allLessons.filter(x => x.status === "assessed").length;
    const summary = { lessons: lessonCount, plans, delivered, assessed, coveragePercent: lessonCount ? Math.round((delivered / lessonCount) * 100) : 0 };
    return c.json({ data: { ...camel(q.rows[0]), topics, summary } });
  });

  r.post("/learning/schemes/:id/topics", requireScope("school:write"), async c => {
    const parsed = topicSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError("Invalid topic", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, schemeId = c.req.param("id"), v = parsed.data;
    await owned(runtime, orgId, "school_schemes_of_work", schemeId);
    const id = createId("sct");
    await runtime.db.query(`INSERT INTO school_scheme_topics(id,organization_id,scheme_id,title,description,week_from,week_to,planned_start_on,planned_end_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, orgId, schemeId, v.title, v.description ?? null, v.weekFrom ?? null, v.weekTo ?? null, v.plannedStartOn ?? null, v.plannedEndOn ?? null]);
    return c.json({ data: { id, schemeId, ...v, status: "planned" } }, 201);
  });

  r.post("/learning/topics/:id/lessons", requireScope("school:write"), async c => {
    const parsed = lessonSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError("Invalid lesson", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, topicId = c.req.param("id"), v = parsed.data;
    await owned(runtime, orgId, "school_scheme_topics", topicId);
    const nextQ = await runtime.db.query(`SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM school_scheme_lessons WHERE organization_id=$1 AND topic_id=$2`, [orgId, topicId]);
    const sequenceNo = Number(nextQ.rows[0]?.next ?? 1), id = createId("scl");
    await runtime.db.query(`INSERT INTO school_scheme_lessons(id,organization_id,topic_id,sequence_no,title,subtopic,planned_date,duration_minutes,learning_outcomes,teaching_methods,learning_resources,learner_activities,assessment_strategy,values_and_cross_cutting) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, orgId, topicId, sequenceNo, v.title, v.subtopic ?? null, v.plannedDate ?? null, v.durationMinutes, v.learningOutcomes ?? null, v.teachingMethods ?? null, v.learningResources ?? null, v.learnerActivities ?? null, v.assessmentStrategy ?? null, v.valuesAndCrossCutting ?? null]);
    await refreshTopicStatus(runtime, orgId, topicId);
    return c.json({ data: { id, topicId, sequenceNo, ...v, status: "planned", competencies: [] } }, 201);
  });

  r.put("/learning/lessons/:id/competencies", requireScope("school:write"), async c => {
    const parsed = competenciesSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError("Invalid competencies", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, lessonId = c.req.param("id"), items = parsed.data.competencies;
    await owned(runtime, orgId, "school_scheme_lessons", lessonId);
    const client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM school_scheme_lesson_competencies WHERE organization_id=$1 AND lesson_id=$2`, [orgId, lessonId]);
      for (const item of items) await client.query(`INSERT INTO school_scheme_lesson_competencies(id,organization_id,lesson_id,competency_type,code,title,description,success_criteria) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [createId("cmp"), orgId, lessonId, item.competencyType, item.code ?? null, item.title, item.description ?? null, item.successCriteria ?? null]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    const q = await runtime.db.query(`SELECT * FROM school_scheme_lesson_competencies WHERE organization_id=$1 AND lesson_id=$2 ORDER BY id`, [orgId, lessonId]);
    return c.json({ data: q.rows.map(camel) });
  });

  r.post("/learning/lessons/:id/lesson-plan", requireScope("school:write"), async c => {
    const parsed = planSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError("Invalid lesson plan", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, lessonId = c.req.param("id"), v = parsed.data;
    await owned(runtime, orgId, "school_scheme_lessons", lessonId);
    const lesson = await lessonContext(runtime, orgId, lessonId);
    if (lesson.lesson_plan_id) throw new AppError(409, "LESSON_PLAN_EXISTS", "This lesson already has a lesson plan");
    const competencyCount = await runtime.db.query(`SELECT COUNT(*)::int AS count FROM school_scheme_lesson_competencies WHERE organization_id=$1 AND lesson_id=$2`, [orgId, lessonId]);
    if (!Number(competencyCount.rows[0]?.count ?? 0)) throw validationError("Add at least one competency before drafting the lesson plan");
    const id = createId("slp"), client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO school_scheme_lesson_plans(id,organization_id,lesson_id,lesson_date,prior_knowledge,introduction_text,lesson_development,teacher_activities,learner_activities,differentiated_instruction,special_needs_accommodations,lesson_conclusion,homework) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, orgId, lessonId, v.lessonDate, v.priorKnowledge ?? null, v.introductionText ?? null, v.lessonDevelopment ?? null, v.teacherActivities ?? null, v.learnerActivities ?? null, v.differentiatedInstruction ?? null, v.specialNeedsAccommodations ?? null, v.lessonConclusion ?? null, v.homework ?? null]);
      await client.query(`UPDATE school_scheme_lessons SET lesson_plan_id=$1,status='plan_drafted',updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`, [id, lessonId, orgId]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    return c.json({ data: { id, lessonId, status: "draft", ...v } }, 201);
  });

  r.get("/learning/lesson-plans/:id", async c => {
    const p = c.get("principal"), orgId = p.organizationId, planId = c.req.param("id"), row = await planContext(runtime, orgId, planId);
    const competencies = await runtime.db.query(`SELECT * FROM school_scheme_lesson_competencies WHERE organization_id=$1 AND lesson_id=$2 ORDER BY id`, [orgId, row.lesson_id]);
    const data = camel(row);
    delete data.topicId; delete data.schemeId; delete data.academicYearId; delete data.termId; delete data.classId; delete data.streamId; delete data.subjectId; delete data.teacherStaffId; delete data.schemeStatus;
    data.competencies = competencies.rows.map(camel);
    return c.json({ data });
  });

  r.post("/learning/lesson-plans/:id/submit", requireScope("school:write"), async c => {
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), row = await planContext(runtime, orgId, id);
    if (row.status !== "draft") throw new AppError(409, "INVALID_WORKFLOW", "Only a draft lesson plan can be submitted");
    await runtime.db.query(`UPDATE school_scheme_lesson_plans SET status='submitted',submitted_at=CURRENT_TIMESTAMP,review_notes=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`, [id, orgId]);
    return c.json({ data: { id, status: "submitted" } });
  });

  r.post("/learning/lesson-plans/:id/resubmit", requireScope("school:write"), async c => {
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), row = await planContext(runtime, orgId, id);
    if (row.status !== "rejected") throw new AppError(409, "INVALID_WORKFLOW", "Only a rejected lesson plan can be resubmitted");
    await runtime.db.query(`UPDATE school_scheme_lesson_plans SET status='submitted',submitted_at=CURRENT_TIMESTAMP,review_notes=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`, [id, orgId]);
    return c.json({ data: { id, status: "submitted" } });
  });

  r.post("/learning/lesson-plans/:id/approve", requireScope("school:write"), async c => {
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), row = await planContext(runtime, orgId, id);
    if (row.status !== "submitted") throw new AppError(409, "INVALID_WORKFLOW", "Only a submitted lesson plan can be approved");
    await runtime.db.query(`UPDATE school_scheme_lesson_plans SET status='approved',reviewed_at=CURRENT_TIMESTAMP,review_notes=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`, [id, orgId]);
    return c.json({ data: { id, status: "approved" } });
  });

  r.post("/learning/lesson-plans/:id/reject", requireScope("school:write"), async c => {
    const parsed = optionalFeedbackSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw validationError("Invalid lesson-plan feedback", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), row = await planContext(runtime, orgId, id);
    if (row.status !== "submitted") throw new AppError(409, "INVALID_WORKFLOW", "Only a submitted lesson plan can be returned");
    await runtime.db.query(`UPDATE school_scheme_lesson_plans SET status='rejected',reviewed_at=CURRENT_TIMESTAMP,review_notes=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`, [parsed.data.feedback ?? "Changes requested.", id, orgId]);
    return c.json({ data: { id, status: "rejected", reviewNotes: parsed.data.feedback ?? "Changes requested." } });
  });

  r.post("/learning/lessons/:id/deliver", requireScope("school:write"), async c => {
    const parsed = deliverySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError("Invalid lesson delivery", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, lessonId = c.req.param("id"), v = parsed.data;
    await owned(runtime, orgId, "school_scheme_lessons", lessonId);
    const lesson = await lessonContext(runtime, orgId, lessonId);
    if (!lesson.lesson_plan_id || lesson.lesson_plan_status !== "approved") throw new AppError(409, "PLAN_NOT_APPROVED", "The lesson plan must be approved before delivery can be recorded");
    if (["delivered", "assessed"].includes(String(lesson.status))) throw new AppError(409, "LESSON_ALREADY_DELIVERED", "Delivery has already been recorded for this lesson");
    const id = createId("dly"), client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO school_scheme_lesson_deliveries(id,organization_id,lesson_id,taught_on,actual_starts_at,actual_ends_at,lesson_notes,teacher_reflection) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, orgId, lessonId, v.taughtOn, v.actualStartsAt ?? null, v.actualEndsAt ?? null, v.lessonNotes ?? null, v.teacherReflection ?? null]);
      await client.query(`UPDATE school_scheme_lessons SET status='delivered',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`, [lessonId, orgId]);
      await client.query("COMMIT");
    } catch (e: any) {
      await client.query("ROLLBACK");
      if (e?.code === "23505") throw new AppError(409, "LESSON_ALREADY_DELIVERED", "Delivery has already been recorded for this lesson");
      throw e;
    } finally { client.release(); }
    await refreshTopicStatus(runtime, orgId, String(lesson.topic_id));
    const coverage = await getCoverage(runtime, orgId, String(lesson.scheme_id));
    return c.json({ data: { id, lessonId, ...v, coveragePercent: coverage.coveragePercent } }, 201);
  });

  r.get("/learning/lesson-plans/:id/assessment", async c => {
    const p = c.get("principal"), orgId = p.organizationId, planId = c.req.param("id"), plan = await planContext(runtime, orgId, planId);
    const assessmentQ = await runtime.db.query(`SELECT * FROM school_scheme_lesson_assessments WHERE organization_id=$1 AND lesson_id=$2`, [orgId, plan.lesson_id]);
    const assessment = assessmentQ.rows[0] ?? null;
    const learners = await eligibleLearners(runtime, orgId, String(plan.academic_year_id), String(plan.class_id), plan.stream_id ? String(plan.stream_id) : null);
    let markMap = new Map<string, Record<string, unknown>>();
    if (assessment) {
      const marks = await runtime.db.query(`SELECT * FROM school_scheme_lesson_marks WHERE organization_id=$1 AND assessment_id=$2`, [orgId, assessment.id]);
      markMap = new Map(marks.rows.map(row => [String(row.student_id), camel(row)]));
    }
    const rows = learners.map(learner => ({ ...learner, mark: markMap.get(String(learner.id)) ?? null }));
    const recorded = rows.filter(x => x.mark && ((x.mark as any).score != null || (x.mark as any).absent)).length;
    const absent = rows.filter(x => Boolean((x.mark as any)?.absent)).length;
    const scores = rows.map(x => (x.mark as any)?.score).filter(x => x != null && Number.isFinite(Number(x))).map(Number);
    const average = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;
    return c.json({ data: { assessment: assessment ? camel(assessment) : null, learners: rows, summary: { learners: rows.length, recorded, absent, average } } });
  });

  r.put("/learning/lesson-plans/:id/assessment", requireScope("school:write"), async c => {
    const parsed = assessmentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError("Invalid lesson assessment", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, planId = c.req.param("id"), v = parsed.data, plan = await planContext(runtime, orgId, planId);
    if (!["delivered", "assessed"].includes(String(plan.lesson_status))) throw new AppError(409, "LESSON_NOT_DELIVERED", "Record lesson delivery before entering marks");
    const existing = await runtime.db.query(`SELECT * FROM school_scheme_lesson_assessments WHERE organization_id=$1 AND lesson_id=$2`, [orgId, plan.lesson_id]);
    if (existing.rows[0]?.status === "submitted") throw new AppError(409, "ASSESSMENT_LOCKED", "Submitted lesson marks are locked");
    const learners = await eligibleLearners(runtime, orgId, String(plan.academic_year_id), String(plan.class_id), plan.stream_id ? String(plan.stream_id) : null);
    const eligible = new Set(learners.map(x => String(x.id)));
    const seen = new Set<string>();
    for (const mark of v.marks) {
      if (seen.has(mark.studentId)) throw validationError("Duplicate learner in mark sheet", { studentId: mark.studentId });
      seen.add(mark.studentId);
      await owned(runtime, orgId, "school_students", mark.studentId);
      if (!eligible.has(mark.studentId)) throw validationError("A learner in the mark sheet is not enrolled in this scheme's class/stream", { studentId: mark.studentId });
      if (!mark.absent && mark.score != null && mark.score > v.maxScore) throw validationError("A learner score cannot exceed the assessment maximum", { studentId: mark.studentId, score: mark.score, maxScore: v.maxScore });
    }
    const assessmentId = existing.rows[0]?.id ? String(existing.rows[0].id) : createId("asm"), client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      if (existing.rows[0]) await client.query(`UPDATE school_scheme_lesson_assessments SET title=$1,assessment_type=$2,max_score=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND organization_id=$5`, [v.title, v.assessmentType, v.maxScore, assessmentId, orgId]);
      else await client.query(`INSERT INTO school_scheme_lesson_assessments(id,organization_id,lesson_id,title,assessment_type,max_score) VALUES($1,$2,$3,$4,$5,$6)`, [assessmentId, orgId, plan.lesson_id, v.title, v.assessmentType, v.maxScore]);
      for (const mark of v.marks) {
        await client.query(`INSERT INTO school_scheme_lesson_marks(id,organization_id,assessment_id,student_id,score,absent,competency_level,remark) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(organization_id,assessment_id,student_id) DO UPDATE SET score=EXCLUDED.score,absent=EXCLUDED.absent,competency_level=EXCLUDED.competency_level,remark=EXCLUDED.remark`,
          [createId("mrk"), orgId, assessmentId, mark.studentId, mark.absent ? null : mark.score, mark.absent, mark.competencyLevel, mark.remark ?? null]);
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    return c.json({ data: { id: assessmentId, lessonId: plan.lesson_id, title: v.title, assessmentType: v.assessmentType, maxScore: v.maxScore, status: "draft" } });
  });

  r.post("/learning/lesson-plans/:id/assessment/submit", requireScope("school:write"), async c => {
    const p = c.get("principal"), orgId = p.organizationId, planId = c.req.param("id"), plan = await planContext(runtime, orgId, planId);
    const q = await runtime.db.query(`SELECT * FROM school_scheme_lesson_assessments WHERE organization_id=$1 AND lesson_id=$2`, [orgId, plan.lesson_id]);
    if (!q.rowCount) throw new AppError(409, "ASSESSMENT_NOT_FOUND", "Save the lesson mark sheet before submitting it");
    if (q.rows[0].status === "submitted") throw new AppError(409, "ASSESSMENT_LOCKED", "Lesson marks have already been submitted");
    const client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE school_scheme_lesson_assessments SET status='submitted',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`, [q.rows[0].id, orgId]);
      await client.query(`UPDATE school_scheme_lessons SET status='assessed',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`, [plan.lesson_id, orgId]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    await refreshTopicStatus(runtime, orgId, String(plan.topic_id));
    const coverage = await getCoverage(runtime, orgId, String(plan.scheme_id));
    return c.json({ data: { id: q.rows[0].id, status: "submitted", lessonStatus: "assessed", coveragePercent: coverage.coveragePercent } });
  });

  r.post("/learning/schemes/:id/submit", requireScope("school:write"), async c => {
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), scheme = await requireScheme(runtime, orgId, id);
    if (!["draft", "rejected"].includes(String(scheme.status))) throw new AppError(409, "INVALID_WORKFLOW", "Only a draft or rejected scheme can be submitted to HOD");
    const readiness = await runtime.db.query(`
      SELECT (SELECT COUNT(*)::int FROM school_scheme_topics t WHERE t.organization_id=$1 AND t.scheme_id=$2) AS topics,
             (SELECT COUNT(*)::int FROM school_scheme_lessons l JOIN school_scheme_topics t ON t.id=l.topic_id AND t.organization_id=$1 WHERE l.organization_id=$1 AND t.scheme_id=$2) AS lessons,
             (SELECT COUNT(*)::int FROM school_scheme_topics t WHERE t.organization_id=$1 AND t.scheme_id=$2 AND NOT EXISTS (SELECT 1 FROM school_scheme_lessons l WHERE l.organization_id=$1 AND l.topic_id=t.id)) AS topics_without_lessons,
             (SELECT COUNT(*)::int FROM school_scheme_lessons l JOIN school_scheme_topics t ON t.id=l.topic_id AND t.organization_id=$1 WHERE l.organization_id=$1 AND t.scheme_id=$2 AND NOT EXISTS (SELECT 1 FROM school_scheme_lesson_competencies cp WHERE cp.organization_id=$1 AND cp.lesson_id=l.id)) AS lessons_without_competencies
    `, [orgId, id]);
    const ready = readiness.rows[0];
    if (!Number(ready.topics) || !Number(ready.lessons) || Number(ready.topics_without_lessons) || Number(ready.lessons_without_competencies)) throw validationError("Add lessons and competencies to every scheme topic before submitting to HOD", camel(ready));
    await runtime.db.query(`UPDATE school_schemes_of_work SET status='submitted_hod',submitted_at=CURRENT_TIMESTAMP,submitted_by=$1,reviewed_at=NULL,reviewed_by=NULL,review_notes=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`, [p.userId, id, orgId]);
    return c.json({ data: { id, status: "submitted_hod" } });
  });

  r.post("/learning/schemes/:id/hod-approve", requireScope("school:write"), async c => {
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), scheme = await requireScheme(runtime, orgId, id);
    if (scheme.status !== "submitted_hod") throw new AppError(409, "INVALID_WORKFLOW", "Only a scheme submitted to HOD can be HOD-approved");
    await runtime.db.query(`UPDATE school_schemes_of_work SET status='hod_approved',reviewed_at=CURRENT_TIMESTAMP,reviewed_by=$1,review_notes=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`, [p.userId, id, orgId]);
    return c.json({ data: { id, status: "hod_approved" } });
  });

  r.post("/learning/schemes/:id/submit-dos", requireScope("school:write"), async c => {
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), scheme = await requireScheme(runtime, orgId, id);
    if (scheme.status !== "hod_approved") throw new AppError(409, "INVALID_WORKFLOW", "Only an HOD-approved scheme can be submitted to DOS");
    await runtime.db.query(`UPDATE school_schemes_of_work SET status='submitted_dos',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`, [id, orgId]);
    return c.json({ data: { id, status: "submitted_dos" } });
  });

  r.post("/learning/schemes/:id/dos-approve", requireScope("school:write"), async c => {
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), scheme = await requireScheme(runtime, orgId, id);
    if (scheme.status !== "submitted_dos") throw new AppError(409, "INVALID_WORKFLOW", "Only a scheme submitted to DOS can be approved");
    await runtime.db.query(`UPDATE school_schemes_of_work SET status='approved',reviewed_at=CURRENT_TIMESTAMP,reviewed_by=$1,review_notes=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`, [p.userId, id, orgId]);
    return c.json({ data: { id, status: "approved" } });
  });

  r.post("/learning/schemes/:id/reject", requireScope("school:write"), async c => {
    const parsed = feedbackSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw validationError("Feedback is required when returning a scheme", parsed.error.flatten());
    const p = c.get("principal"), orgId = p.organizationId, id = c.req.param("id"), scheme = await requireScheme(runtime, orgId, id);
    if (!["submitted_hod", "hod_approved", "submitted_dos"].includes(String(scheme.status))) throw new AppError(409, "INVALID_WORKFLOW", "This scheme is not currently under review");
    await runtime.db.query(`UPDATE school_schemes_of_work SET status='rejected',reviewed_at=CURRENT_TIMESTAMP,reviewed_by=$1,review_notes=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND organization_id=$4`, [p.userId, parsed.data.feedback, id, orgId]);
    return c.json({ data: { id, status: "rejected", reviewNotes: parsed.data.feedback } });
  });

  r.get("/learning/dashboard", async c => {
    const p = c.get("principal"), orgId = p.organizationId;
    const [schemesQ, topicsQ, lessonsQ, plansQ, assessedQ, coverageQ] = await Promise.all([
      runtime.db.query(`SELECT COUNT(*)::int AS count FROM school_schemes_of_work WHERE organization_id=$1 AND status<>'archived'`, [orgId]),
      runtime.db.query(`SELECT COUNT(*)::int AS count FROM school_scheme_topics WHERE organization_id=$1`, [orgId]),
      runtime.db.query(`SELECT COUNT(*)::int AS count FROM school_scheme_lessons WHERE organization_id=$1`, [orgId]),
      runtime.db.query(`SELECT COUNT(*)::int AS count FROM school_scheme_lesson_plans WHERE organization_id=$1`, [orgId]),
      runtime.db.query(`SELECT COUNT(*)::int AS count FROM school_scheme_lessons WHERE organization_id=$1 AND status='assessed'`, [orgId]),
      runtime.db.query(`SELECT COUNT(*)::int AS lessons,COUNT(*) FILTER (WHERE status IN ('delivered','assessed'))::int AS delivered FROM school_scheme_lessons WHERE organization_id=$1`, [orgId])
    ]);
    const lessons = Number(coverageQ.rows[0]?.lessons ?? 0), delivered = Number(coverageQ.rows[0]?.delivered ?? 0);
    return c.json({ data: {
      schemes: Number(schemesQ.rows[0]?.count ?? 0), topics: Number(topicsQ.rows[0]?.count ?? 0), lessons: Number(lessonsQ.rows[0]?.count ?? 0),
      plans: Number(plansQ.rows[0]?.count ?? 0), assessed: Number(assessedQ.rows[0]?.count ?? 0), coveragePercent: lessons ? Math.round((delivered / lessons) * 100) : 0
    }});
  });

  return r;
}
