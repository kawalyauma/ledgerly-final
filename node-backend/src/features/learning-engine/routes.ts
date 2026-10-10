import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { ulibtech } from "../school-management/ulibtech.js";
import { createId } from "../core-identity/security.js";
import { addPage, assignPageStudent, createBatch, createBatchSchema, getBatch, getPage, pageImage, submitBatch } from "./captures.js";
import { enqueueTask, getSettings, updateSettings } from "./engine.js";
import { coverage, recordTeaching, requestStudentSummary, studentOverview, teachingAt, teachingEventSchema, timeline } from "./insights.js";
import { alternatives, compareQuestion, listGroups, listQuestions, practiceSet } from "./questions.js";
import { createScheme, createSchemeSchema, getLesson, getScheme, regenerate, setPublished, writeUntil } from "./schemes.js";
import { lessonPrintHtml } from "./print.js";
import { postSchemeToLibrary, schemeDocx, svgToPng } from "./export.js";
import { codedFigureRow, figureExamItem, getFigure, labelFigure, labelingImage, requestFigure } from "./figures.js";
import { codedSpecSchema } from "./figures-coded.js";
import {
  bellSchema, buildPeriodPlan, dayOffSchema, editSlot, generateBell, generateSchema, generateTimetable, getTimetable, getTimetableSettings, listBell, listLoads,
  listPlan, loadsFromSchemes, loadsSchema, publishTimetable, replaceBell, saveLoads, saveTimetableSettings, setPlanStatus, settingsSchema, slotEditSchema,
} from "./timetable.js";

/** Owners and admins pass; everyone else needs one of the listed scopes. */
function anyScope(...scopes: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const p = c.get("principal");
    if (p.role !== "owner" && p.role !== "admin" && !scopes.some(s => p.scopes.includes(s)))
      throw new AppError(403, "FORBIDDEN", `Missing required scope: ${scopes.join(" or ")}`);
    await next();
  };
}
const read = anyScope("learning:read", "school:read");
const write = anyScope("learning:write", "school:write");
const capture = anyScope("learning:capture", "learning:write", "school:write");
const admin = anyScope("learning:admin");

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, message = "Check the request"): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", message, parsed.error.flatten());
  return parsed.data;
}
const body = async (c: { req: { json(): Promise<unknown> } }) => c.req.json().catch(() => ({}));
const id = z.string().min(1).max(160);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paging = { page: z.coerce.number().int().min(1).max(1000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };

export function createLearningRoutes(runtime: Runtime) {
  const r = new Hono<AppEnv>();
  const org = (c: { get(key: "principal"): { organizationId: string } }) => c.get("principal").organizationId;

  /* Engine: provider switch, pause/stop, daily limit, and the step queue. */
  r.get("/engine", read, async c => {
    const o = org(c);
    const [settings, queue, today] = await Promise.all([
      getSettings(runtime, o),
      runtime.db.query(`SELECT kind,status,count(*)::int AS n FROM lrn_ai_tasks WHERE organization_id=$1 AND (status IN ('queued','running') OR finished_at > CURRENT_TIMESTAMP - INTERVAL '1 day') GROUP BY 1,2`, [o]),
      runtime.db.query(`SELECT count(*)::int AS steps,COALESCE(sum(prompt_chars),0)::bigint AS "promptChars",COALESCE(sum(duration_ms),0)::bigint AS "durationMs"
        FROM lrn_ai_tasks WHERE organization_id=$1 AND provider IS NOT NULL AND started_at >= date_trunc('day',CURRENT_TIMESTAMP)`, [o]),
    ]);
    return c.json({ data: { settings, queue: queue.rows, today: today.rows[0] } });
  });
  r.put("/engine", admin, async c => {
    const v = parse(z.object({
      provider: z.enum(["codex", "claude-code"]).optional(),
      state: z.enum(["running", "paused", "stopped"]).optional(),
      dailyTaskLimit: z.number().int().min(0).max(5000).optional(),
      maxPromptChars: z.number().int().min(8000).max(200000).optional(),
      imageGeneration: z.boolean().optional(),
      dailyImageLimit: z.number().int().min(0).max(1000).optional(),
    }), await body(c));
    const p = c.get("principal");
    return c.json({ data: await updateSettings(runtime, p.organizationId, p.userId, v) });
  });
  r.post("/engine/stop", admin, async c => { const p = c.get("principal"); return c.json({ data: await updateSettings(runtime, p.organizationId, p.userId, { state: "stopped" }) }); });
  r.post("/engine/start", admin, async c => { const p = c.get("principal"); return c.json({ data: await updateSettings(runtime, p.organizationId, p.userId, { state: "running" }) }); });
  r.get("/engine/tasks", read, async c => {
    const f = parse(z.object({ status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(), kind: z.string().max(40).optional(), ...paging }), c.req.query());
    const rows = await runtime.db.query(
      `SELECT id,kind,subject_ref AS "subjectRef",status,attempts,provider,prompt_chars AS "promptChars",duration_ms AS "durationMs",error,result,
              created_at AS "createdAt",started_at AS "startedAt",finished_at AS "finishedAt"
         FROM lrn_ai_tasks WHERE organization_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR kind=$3)
        ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,COALESCE(finished_at,created_at) DESC LIMIT $4 OFFSET $5`,
      [org(c), f.status ?? null, f.kind ?? null, f.pageSize, (f.page - 1) * f.pageSize]);
    return c.json({ data: rows.rows });
  });
  r.post("/engine/tasks/:id/cancel", admin, async c => {
    const row = await runtime.db.query(`UPDATE lrn_ai_tasks SET status='cancelled',finished_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status IN ('queued','running') RETURNING id`, [c.req.param("id"), org(c)]);
    if (!row.rowCount) throw new AppError(404, "NOT_FOUND", "No active step with that id");
    return c.json({ data: { id: c.req.param("id"), status: "cancelled" } });
  });
  r.post("/engine/tasks/:id/retry", admin, async c => {
    const row = await runtime.db.query<{ kind: string; subjectRef: string }>(
      `SELECT kind,subject_ref AS "subjectRef" FROM lrn_ai_tasks WHERE id=$1 AND organization_id=$2 AND status IN ('failed','cancelled')`, [c.req.param("id"), org(c)]);
    if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "No failed step with that id");
    await enqueueTask(runtime, org(c), row.rows[0].kind as never, row.rows[0].subjectRef, { requestedBy: c.get("principal").userId });
    return c.json({ data: { retried: true } }, 202);
  });

  /* E-library material available for a class/subject (to pick sources by hand). */
  r.get("/library/search", read, async c => {
    const f = parse(z.object({ q: z.string().max(200).optional(), class: z.string().max(40).optional(), subject: z.string().max(80).optional(),
      type: z.string().max(40).optional(), term: z.string().max(40).optional(), page: z.coerce.number().int().min(1).max(100).default(1) }), c.req.query());
    return c.json({ data: await ulibtech(runtime).search({ ...f, pageSize: 24 }) });
  });

  /* Schemes of work. */
  r.get("/schemes", read, async c => {
    const f = parse(z.object({ classId: id.optional(), subjectId: id.optional(), termId: id.optional(), status: z.string().max(20).optional() }), c.req.query());
    const rows = await runtime.db.query(
      `SELECT sc.id,sc.title,sc.status,sc.error,c.name AS "className",s.name AS "subjectName",t.name AS "termName",sc.updated_at AS "updatedAt",
              count(l.id)::int AS lessons,count(l.id) FILTER (WHERE l.status IN ('written','reviewed'))::int AS written,count(l.id) FILTER (WHERE l.status='failed')::int AS failed
         FROM lrn_schemes sc JOIN school_classes c ON c.id=sc.class_id JOIN school_subjects s ON s.id=sc.subject_id JOIN school_terms t ON t.id=sc.term_id
         LEFT JOIN lrn_lessons l ON l.scheme_id=sc.id
        WHERE sc.organization_id=$1 AND ($2::text IS NULL OR sc.class_id=$2) AND ($3::text IS NULL OR sc.subject_id=$3) AND ($4::text IS NULL OR sc.term_id=$4)
          AND ($5::text IS NULL OR sc.status=$5) AND sc.status<>'archived'
        GROUP BY sc.id,c.name,s.name,t.name ORDER BY sc.updated_at DESC LIMIT 300`,
      [org(c), f.classId ?? null, f.subjectId ?? null, f.termId ?? null, f.status ?? null]);
    return c.json({ data: rows.rows });
  });
  r.post("/schemes", write, async c => {
    const v = parse(createSchemeSchema, await body(c), "Check the scheme details");
    const p = c.get("principal");
    return c.json({ data: await createScheme(runtime, p.organizationId, p.userId, v) }, 202);
  });
  r.get("/schemes/:id", read, async c => c.json({ data: await getScheme(runtime, org(c), c.req.param("id")) }));
  r.post("/schemes/:id/regenerate", write, async c => {
    const v = parse(z.object({ what: z.enum(["sources", "outline", "failed_lessons"]) }), await body(c));
    const p = c.get("principal");
    return c.json({ data: await regenerate(runtime, p.organizationId, p.userId, c.req.param("id"), v.what) }, 202);
  });
  r.get("/schemes/:id/export.docx", read, async c => {
    const week = Number(c.req.query("untilWeek")) || undefined;
    const doc = await schemeDocx(runtime, org(c), c.req.param("id"), week);
    return new Response(Buffer.from(doc.bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${doc.fileName}"`,
    } });
  });
  r.post("/schemes/:id/library", write, async c => {
    const v = parse(z.object({ untilWeek: z.number().int().min(1).max(20).optional() }), await body(c));
    const p = c.get("principal");
    return c.json({ data: await postSchemeToLibrary(runtime, p.organizationId, p.userId, c.req.param("id"), v.untilWeek) }, 201);
  });
  r.get("/schemes/:id/library", read, async c => c.json({ data: (await runtime.db.query(
    `SELECT external_slug AS slug,page_url AS url,weeks,status,created_at AS "createdAt" FROM lrn_library_posts WHERE scheme_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
    [c.req.param("id"), org(c)])).rows }));
  r.post("/schemes/:id/write", write, async c => {
    const v = parse(z.object({ untilWeek: z.number().int().min(1).max(20).nullable() }), await body(c));
    const p = c.get("principal");
    return c.json({ data: await writeUntil(runtime, p.organizationId, p.userId, c.req.param("id"), v.untilWeek) }, 202);
  });
  r.post("/schemes/:id/publish", write, async c => { const p = c.get("principal"); return c.json({ data: await setPublished(runtime, p.organizationId, p.userId, c.req.param("id"), true) }); });
  r.post("/schemes/:id/unpublish", write, async c => { const p = c.get("principal"); return c.json({ data: await setPublished(runtime, p.organizationId, p.userId, c.req.param("id"), false) }); });
  r.delete("/schemes/:id", write, async c => {
    await runtime.db.query(`UPDATE lrn_ai_tasks SET status='cancelled',finished_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND status IN ('queued','running')
      AND (subject_ref=$2 OR subject_ref IN (SELECT id FROM lrn_lessons WHERE scheme_id=$2))`, [org(c), c.req.param("id")]);
    const row = await runtime.db.query(`UPDATE lrn_schemes SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 RETURNING id`, [c.req.param("id"), org(c)]);
    if (!row.rowCount) throw new AppError(404, "NOT_FOUND", "Scheme not found");
    return c.json({ data: { id: c.req.param("id"), status: "archived" } });
  });
  r.get("/lessons/:id", read, async c => c.json({ data: await getLesson(runtime, org(c), c.req.param("id")) }));
  r.post("/lessons/:id/rewrite", write, async c => {
    const row = await runtime.db.query(`UPDATE lrn_lessons SET status='pending',error=NULL WHERE id=$1 AND organization_id=$2 RETURNING id`, [c.req.param("id"), org(c)]);
    if (!row.rowCount) throw new AppError(404, "NOT_FOUND", "Lesson not found");
    await enqueueTask(runtime, org(c), "lesson.write", c.req.param("id"), { priority: 40, requestedBy: c.get("principal").userId });
    return c.json({ data: { id: c.req.param("id"), status: "pending" } }, 202);
  });

  /* Question bank. */
  r.get("/questions", read, async c => {
    const f = parse(z.object({ classId: id.optional(), subjectId: id.optional(), termId: id.optional(), groupId: id.optional(), lessonId: id.optional(),
      q: z.string().max(200).optional(), origin: z.enum(["elibrary", "capture"]).optional(), ...paging }), c.req.query());
    return c.json({ data: await listQuestions(runtime, org(c), f) });
  });
  r.get("/questions/groups", read, async c => {
    const f = parse(z.object({ classId: id.optional(), subjectId: id.optional(), termId: id.optional() }), c.req.query());
    return c.json({ data: await listGroups(runtime, org(c), f) });
  });
  r.post("/questions/compare", read, async c => {
    const v = parse(z.object({ questionId: id.optional(), stem: z.string().max(2000).optional(), classId: id.optional(), subjectId: id.optional(),
      concept: z.string().max(200).optional(), skill: z.string().max(200).optional() }), await body(c));
    return c.json({ data: await compareQuestion(runtime, org(c), v) });
  });
  r.get("/questions/:id/alternatives", read, async c => {
    const f = parse(z.object({ count: z.coerce.number().int().min(1).max(50).default(5), studentId: id.optional(), harder: z.coerce.boolean().optional() }), c.req.query());
    return c.json({ data: await alternatives(runtime, org(c), c.req.param("id"), f) });
  });
  r.post("/questions/practice-set", read, async c => {
    const v = parse(z.object({ classId: id, subjectId: id.optional(), termId: id.optional(), lessonId: id.optional(), groupIds: z.array(id).max(30).optional(),
      studentId: id.optional(), count: z.number().int().min(1).max(100).default(10), markGiven: z.boolean().default(false) }), await body(c));
    return c.json({ data: await practiceSet(runtime, org(c), v) });
  });
  r.post("/questions/:id/retire", write, async c => {
    const row = await runtime.db.query(`UPDATE lrn_questions SET status='retired' WHERE id=$1 AND organization_id=$2 RETURNING id`, [c.req.param("id"), org(c)]);
    if (!row.rowCount) throw new AppError(404, "NOT_FOUND", "Question not found");
    return c.json({ data: { id: c.req.param("id"), status: "retired" } });
  });

  /* Scanner: batches of book pages. */
  r.get("/captures/batches", read, async c => {
    const f = parse(z.object({ classId: id.optional(), status: z.string().max(20).optional(), ...paging }), c.req.query());
    const rows = await runtime.db.query(
      `SELECT b.id,b.kind,b.title,b.status,b.page_count AS "pageCount",b.captured_on::text AS "capturedOn",c.name AS "className",s.name AS "subjectName",b.created_at AS "createdAt"
         FROM lrn_capture_batches b LEFT JOIN school_classes c ON c.id=b.class_id LEFT JOIN school_subjects s ON s.id=b.subject_id
        WHERE b.organization_id=$1 AND ($2::text IS NULL OR b.class_id=$2) AND ($3::text IS NULL OR b.status=$3)
        ORDER BY b.created_at DESC LIMIT $4 OFFSET $5`, [org(c), f.classId ?? null, f.status ?? null, f.pageSize, (f.page - 1) * f.pageSize]);
    return c.json({ data: rows.rows });
  });
  // Everything the scanner app needs to start batches and tag learners, in one call.
  r.get("/captures/context", capture, async c => {
    const o = org(c), classId = c.req.query("classId") || null;
    const [school, classes, subjects, term, students] = await Promise.all([
      runtime.db.query(`SELECT name FROM organizations WHERE id=$1`, [o]),
      runtime.db.query(`SELECT id,name FROM school_classes WHERE organization_id=$1 AND active ORDER BY name`, [o]),
      runtime.db.query(`SELECT id,name FROM school_subjects WHERE organization_id=$1 AND active ORDER BY name`, [o]),
      runtime.db.query(`SELECT id,name,starts_on::text AS "startsOn",ends_on::text AS "endsOn" FROM school_terms WHERE organization_id=$1 ORDER BY is_current DESC,starts_on DESC LIMIT 1`, [o]),
      classId ? runtime.db.query(
        `SELECT st.id,concat_ws(' ',st.first_name,st.middle_name,st.last_name) AS name,st.admission_number AS "admissionNumber"
           FROM school_students st WHERE st.organization_id=$1 AND st.deleted_at IS NULL AND st.status='active'
            AND (st.current_class_id=$2 OR EXISTS (SELECT 1 FROM school_enrollments e WHERE e.student_id=st.id AND e.class_id=$2 AND e.status='active'))
          ORDER BY st.first_name,st.last_name LIMIT 300`, [o, classId]) : Promise.resolve({ rows: [] }),
    ]);
    return c.json({ data: { school: school.rows[0]?.name ?? null, classes: classes.rows, subjects: subjects.rows, term: term.rows[0] ?? null, students: students.rows } });
  });
  r.post("/captures/batches", capture, async c => {
    const v = parse(createBatchSchema, await body(c), "Check the scan batch details");
    const p = c.get("principal");
    return c.json({ data: await createBatch(runtime, p.organizationId, p.userId, v) }, 201);
  });
  r.get("/captures/batches/:id", read, async c => c.json({ data: await getBatch(runtime, org(c), c.req.param("id")) }));
  // Multipart: file, clientPageId, seq?, studentId?, analyze? ("1" queues the page immediately).
  r.post("/captures/batches/:id/pages", capture, async c => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError(422, "FILE_REQUIRED", "Attach the page image as 'file'");
    const v = parse(z.object({ clientPageId: z.string().trim().min(1).max(120), seq: z.coerce.number().int().min(1).max(100000).optional(),
      studentId: id.optional(), analyze: z.enum(["0", "1", "true", "false"]).optional() }),
      Object.fromEntries([...form.entries()].filter(([k, value]) => k !== "file" && typeof value === "string")));
    const p = c.get("principal");
    const page = await addPage(runtime, p.organizationId, c.req.param("id"), {
      clientPageId: v.clientPageId, seq: v.seq, studentId: v.studentId ?? null, bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: (file.type || "image/jpeg").toLowerCase(), analyze: v.analyze === "1" || v.analyze === "true", requestedBy: p.userId,
    });
    return c.json({ data: page }, "duplicateUpload" in page ? 200 : 201);
  });
  r.post("/captures/batches/:id/submit", capture, async c => { const p = c.get("principal"); return c.json({ data: await submitBatch(runtime, p.organizationId, c.req.param("id"), p.userId) }, 202); });
  r.post("/captures/batches/:id/cancel", capture, async c => {
    await runtime.db.query(`UPDATE lrn_ai_tasks SET status='cancelled',finished_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND kind='page.analyze' AND status='queued'
      AND subject_ref IN (SELECT id FROM lrn_capture_pages WHERE batch_id=$2)`, [org(c), c.req.param("id")]);
    const row = await runtime.db.query(`UPDATE lrn_capture_batches SET status='cancelled' WHERE id=$1 AND organization_id=$2 RETURNING id`, [c.req.param("id"), org(c)]);
    if (!row.rowCount) throw new AppError(404, "NOT_FOUND", "Scan batch not found");
    return c.json({ data: { id: c.req.param("id"), status: "cancelled" } });
  });
  r.get("/captures/pages/:id", read, async c => c.json({ data: await getPage(runtime, org(c), c.req.param("id")) }));
  r.get("/captures/pages/:id/image", read, async c => {
    const img = await pageImage(runtime, org(c), c.req.param("id"));
    return new Response(Buffer.from(img.bytes), { headers: { "Content-Type": img.mimeType, "Cache-Control": "private, max-age=3600" } });
  });
  r.post("/captures/pages/:id/student", capture, async c => {
    const v = parse(z.object({ studentId: id }), await body(c));
    return c.json({ data: await assignPageStudent(runtime, org(c), c.req.param("id"), v.studentId) });
  });
  r.post("/captures/pages/:id/reanalyze", capture, async c => {
    const row = await runtime.db.query(`UPDATE lrn_capture_pages SET status='queued',error=NULL WHERE id=$1 AND organization_id=$2 AND status<>'duplicate' RETURNING id`, [c.req.param("id"), org(c)]);
    if (!row.rowCount) throw new AppError(404, "NOT_FOUND", "Page not found");
    await enqueueTask(runtime, org(c), "page.analyze", c.req.param("id"), { priority: 55, requestedBy: c.get("principal").userId });
    return c.json({ data: { id: c.req.param("id"), status: "queued" } }, 202);
  });

  /* What is being taught. */
  r.get("/teaching/now", read, async c => {
    const f = parse(z.object({ date: day.optional(), time: z.string().regex(/^\d{2}:\d{2}$/).optional(), classId: id.optional() }), c.req.query());
    return c.json({ data: await teachingAt(runtime, org(c), f) });
  });
  r.get("/teaching/timeline", read, async c => {
    const f = parse(z.object({ classId: id, subjectId: id.optional(), from: day.optional(), to: day.optional() }), c.req.query());
    return c.json({ data: await timeline(runtime, org(c), f) });
  });
  r.get("/teaching/coverage", read, async c => {
    const f = parse(z.object({ classId: id, termId: id.optional() }), c.req.query());
    return c.json({ data: await coverage(runtime, org(c), f) });
  });
  r.post("/teaching/events", write, async c => {
    const v = parse(teachingEventSchema, await body(c), "Check the lesson record");
    const p = c.get("principal");
    return c.json({ data: await recordTeaching(runtime, p.organizationId, p.userId, v) }, 201);
  });

  /* Learners. */
  r.get("/students/:id/overview", read, async c => {
    const f = parse(z.object({ subjectId: id.optional(), termId: id.optional() }), c.req.query());
    return c.json({ data: await studentOverview(runtime, org(c), c.req.param("id"), f) });
  });
  r.post("/students/:id/summary", write, async c => {
    const p = c.get("principal");
    return c.json({ data: await requestStudentSummary(runtime, p.organizationId, p.userId, c.req.param("id")) }, 202);
  });

  /* Lesson output: printable plan + notes, and diagram images. */
  r.get("/lessons/:id/print", read, async c => {
    const html = await lessonPrintHtml(runtime, org(c), c.req.param("id"));
    return c.html(html, 200, { "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'" });
  });
  r.get("/lessons/:id/assets/:assetId{.+\\.svg}", read, async c => {
    const row = await runtime.db.query<{ svg: string }>(`SELECT svg FROM lrn_lesson_assets WHERE id=$1 AND lesson_id=$2 AND organization_id=$3`,
      [c.req.param("assetId").replace(/\.svg$/, ""), c.req.param("id"), org(c)]);
    if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Diagram not found");
    if (c.req.query("format") === "png") return new Response(Buffer.from(svgToPng(row.rows[0].svg).png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
    return new Response(row.rows[0].svg, { headers: { "Content-Type": "image/svg+xml", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, max-age=3600" } });
  });

  /* Figure library: drawings stored once (unlabelled + part positions), labelled on demand, reused everywhere. */
  r.get("/figures", read, async c => {
    const f = parse(z.object({ q: z.string().max(200).optional(), kind: z.string().max(20).optional(), ...paging }), c.req.query());
    const rows = await runtime.db.query(
      `SELECT id,title,concept_key AS "conceptKey",subject,kind,status,uses,jsonb_array_length(anchors) AS parts,created_at AS "createdAt"
         FROM lrn_figures WHERE (shared OR organization_id=$1) AND status<>'retired' AND ($2::text IS NULL OR title ILIKE '%'||$2||'%' OR concept_key % $2)
          AND ($3::text IS NULL OR kind=$3) ORDER BY uses DESC,created_at DESC LIMIT $4 OFFSET $5`,
      [org(c), f.q ?? null, f.kind ?? null, f.pageSize, (f.page - 1) * f.pageSize]);
    return c.json({ data: rows.rows });
  });
  r.get("/figures/:id", read, async c => {
    const fig = await getFigure(runtime, c.req.param("id"));
    const labelings = await runtime.db.query(`SELECT id,mode,answer_key AS "answerKey",created_at AS "createdAt" FROM lrn_figure_labelings WHERE figure_id=$1 ORDER BY created_at DESC LIMIT 50`, [fig.id]);
    return c.json({ data: { ...fig, svg: undefined, baseImageUrl: `/api/v1/learn/figures/${fig.id}/base.png`, labelings: labelings.rows } });
  });
  r.get("/figures/:id/base.png", read, async c => {
    const fig = await getFigure(runtime, c.req.param("id"));
    const bytes = fig.baseKey ? await runtime.storage.get(fig.baseKey) : fig.svg ? svgToPng(fig.svg).png : null;
    if (!bytes) throw new AppError(404, "NOT_FOUND", "This figure has no image yet");
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
  });
  r.post("/figures/request", write, async c => {
    const v = parse(z.object({ concept: z.string().trim().min(3).max(300), title: z.string().trim().min(1).max(200), parts: z.array(z.string().min(1).max(80)).max(20).default([]),
      subject: z.string().max(80).optional(), level: z.string().max(40).optional(), style: z.string().max(400).optional() }), await body(c));
    const p = c.get("principal");
    const got = await requestFigure(runtime, p.organizationId, p.userId, v);
    return c.json({ data: { ...got, figure: got.figure ? { id: got.figure.id, status: got.figure.status, title: got.figure.title } : null } }, got.reused ? 200 : 202);
  });
  r.post("/figures/coded", write, async c => {
    const spec = parse(codedSpecSchema, await body(c), "Check the figure details");
    const fig = await codedFigureRow(runtime, org(c), spec);
    return c.json({ data: { id: fig.id, title: fig.title, parts: fig.anchors.map(a => a.name), baseImageUrl: `/api/v1/learn/figures/${fig.id}/base.png` } });
  });
  r.post("/figures/:id/labelings", read, async c => {
    const v = parse(z.object({ mode: z.enum(["names", "letters", "blank", "custom"]), parts: z.array(z.string().max(80)).max(30).optional(),
      texts: z.record(z.string(), z.string().max(60)).optional(), seed: z.number().int().min(1).max(1e9).optional(), title: z.string().max(120).nullish() }), await body(c));
    const l = await labelFigure(runtime, c.req.param("id"), v);
    return c.json({ data: { id: l.id, answerKey: l.answerKey, imageUrl: `/api/v1/learn/figures/labelings/${l.id}.png` } });
  });
  r.post("/figures/:id/exam-item", read, async c => {
    const v = parse(z.object({ count: z.number().int().min(1).max(12).default(4), seed: z.number().int().min(1).max(1e9).default(() => Math.floor(Math.random() * 1e9) + 2),
      parts: z.array(z.string().max(80)).max(30).optional(), mode: z.enum(["letters", "blank"]).optional() }), await body(c));
    return c.json({ data: await figureExamItem(runtime, c.req.param("id"), v) });
  });
  r.get("/figures/labelings/:file{.+\\.png}", read, async c => {
    const bytes = await labelingImage(runtime, c.req.param("file").replace(/\.png$/, ""));
    if (!bytes) throw new AppError(404, "NOT_FOUND", "Image not found");
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
  });

  /* Timetable settings, bell, fixed activities, days off. */
  r.get("/timetable/settings", read, async c => c.json({ data: { settings: await getTimetableSettings(runtime, org(c)), bell: await listBell(runtime, org(c)) } }));
  r.put("/timetable/settings", write, async c => {
    const p = c.get("principal");
    const settings = await saveTimetableSettings(runtime, p.organizationId, p.userId, parse(settingsSchema, await body(c), "Check the timetable settings"));
    const bell = c.req.query("keepBell") === "1" ? await listBell(runtime, p.organizationId) : await generateBell(runtime, p.organizationId);
    return c.json({ data: { settings, bell } });
  });
  r.put("/timetable/bell", write, async c => {
    await replaceBell(runtime, org(c), parse(bellSchema, await body(c), "Check the bell schedule"));
    return c.json({ data: await listBell(runtime, org(c)) });
  });
  r.get("/timetable/fixed", read, async c => c.json({ data: (await runtime.db.query(
    `SELECT f.id,f.class_id AS "classId",f.weekday,f.bell_period_id AS "bellPeriodId",f.label FROM lrn_timetable_fixed f WHERE f.organization_id=$1 ORDER BY weekday`, [org(c)])).rows }));
  r.post("/timetable/fixed", write, async c => {
    const v = parse(z.object({ classId: id.nullish(), weekday: z.number().int().min(1).max(7), bellPeriodId: id, label: z.string().trim().min(1).max(60) }), await body(c));
    const row = await runtime.db.query(
      `INSERT INTO lrn_timetable_fixed(id,organization_id,class_id,weekday,bell_period_id,label)
       SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS (SELECT 1 FROM lrn_bell_periods WHERE id=$5 AND organization_id=$2)
          AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM school_classes WHERE id=$3 AND organization_id=$2))
       ON CONFLICT(organization_id,class_id,weekday,bell_period_id) DO UPDATE SET label=EXCLUDED.label RETURNING id`,
      [createId("lfix"), org(c), v.classId ?? null, v.weekday, v.bellPeriodId, v.label]);
    if (!row.rowCount) throw new AppError(404, "NOT_FOUND", "Bell period or class not found");
    return c.json({ data: row.rows[0] }, 201);
  });
  r.delete("/timetable/fixed/:id", write, async c => {
    await runtime.db.query(`DELETE FROM lrn_timetable_fixed WHERE id=$1 AND organization_id=$2`, [c.req.param("id"), org(c)]);
    return c.body(null, 204);
  });
  r.get("/timetable/days-off", read, async c => c.json({ data: (await runtime.db.query(
    `SELECT id,day::text,class_id AS "classId",label FROM lrn_days_off WHERE organization_id=$1 AND day >= CURRENT_DATE - 365 ORDER BY day`, [org(c)])).rows }));
  r.post("/timetable/days-off", write, async c => {
    const v = parse(dayOffSchema, await body(c), "Check the day off");
    const row = await runtime.db.query(
      `INSERT INTO lrn_days_off(id,organization_id,day,class_id,label) SELECT $1,$2,$3,$4,$5
        WHERE $4::text IS NULL OR EXISTS (SELECT 1 FROM school_classes WHERE id=$4 AND organization_id=$2)
       ON CONFLICT(organization_id,day,class_id) DO UPDATE SET label=EXCLUDED.label RETURNING id`, [createId("loff"), org(c), v.day, v.classId ?? null, v.label]);
    // Re-plan published timetables from that day so its lessons move forward.
    const tts = await runtime.db.query<{ id: string }>(`SELECT id FROM lrn_timetables WHERE organization_id=$1 AND status='published'`, [org(c)]);
    for (const t of tts.rows) await buildPeriodPlan(runtime, org(c), { timetableId: t.id, from: v.day, classId: v.classId ?? undefined }).catch(() => undefined);
    return c.json({ data: row.rows[0] ?? null }, 201);
  });
  r.delete("/timetable/days-off/:id", write, async c => {
    const row = await runtime.db.query<{ day: string }>(`DELETE FROM lrn_days_off WHERE id=$1 AND organization_id=$2 RETURNING day::text`, [c.req.param("id"), org(c)]);
    const tts = await runtime.db.query<{ id: string }>(`SELECT id FROM lrn_timetables WHERE organization_id=$1 AND status='published'`, [org(c)]);
    if (row.rows[0]) for (const t of tts.rows) await buildPeriodPlan(runtime, org(c), { timetableId: t.id, from: row.rows[0].day }).catch(() => undefined);
    return c.body(null, 204);
  });

  /* Subject loads (periods per week, teacher, doubles). */
  r.get("/timetable/loads", read, async c => {
    const f = parse(z.object({ termId: id, classId: id.optional() }), c.req.query());
    return c.json({ data: await listLoads(runtime, org(c), f.termId, f.classId) });
  });
  r.put("/timetable/loads", write, async c => c.json({ data: await saveLoads(runtime, org(c), parse(loadsSchema, await body(c), "Check the subject loads")) }));
  r.post("/timetable/loads/prefill", write, async c => {
    const v = parse(z.object({ termId: id }), await body(c));
    return c.json({ data: await loadsFromSchemes(runtime, org(c), v.termId) });
  });

  /* Timetables. */
  r.get("/timetables", read, async c => c.json({ data: (await runtime.db.query(
    `SELECT t.id,t.name,t.status,tr.name AS "termName",t.term_id AS "termId",t.created_at AS "createdAt",t.published_at AS "publishedAt",
            jsonb_array_length(COALESCE(t.report->'unplaced','[]'::jsonb)) AS unplaced
       FROM lrn_timetables t JOIN school_terms tr ON tr.id=t.term_id WHERE t.organization_id=$1 AND t.status<>'archived' ORDER BY t.created_at DESC`, [org(c)])).rows }));
  r.post("/timetables/generate", write, async c => {
    const p = c.get("principal");
    return c.json({ data: await generateTimetable(runtime, p.organizationId, p.userId, parse(generateSchema, await body(c), "Check the timetable request")) }, 201);
  });
  r.get("/timetables/:id", read, async c => c.json({ data: await getTimetable(runtime, org(c), c.req.param("id"), c.req.query("classId") || undefined) }));
  r.put("/timetables/:id/slot", write, async c => c.json({ data: await editSlot(runtime, org(c), c.req.param("id"), parse(slotEditSchema, await body(c), "Check the timetable cell")) }));
  r.post("/timetables/:id/publish", write, async c => { const p = c.get("principal"); return c.json({ data: await publishTimetable(runtime, p.organizationId, p.userId, c.req.param("id")) }); });
  r.post("/timetables/:id/replan", write, async c => {
    const v = parse(z.object({ from: day.optional(), classId: id.optional() }), await body(c));
    return c.json({ data: await buildPeriodPlan(runtime, org(c), { timetableId: c.req.param("id"), ...v }) });
  });

  /* Period plan: which lesson and subtopic each class gets in each period. */
  r.get("/plan", read, async c => {
    const f = parse(z.object({ classId: id.optional(), teacherStaffId: id.optional(), from: day, to: day }), c.req.query());
    if ((Date.parse(f.to) - Date.parse(f.from)) / 86400000 > 120) throw new AppError(422, "RANGE_TOO_LONG", "Ask for at most 120 days at a time");
    return c.json({ data: await listPlan(runtime, org(c), f) });
  });
  r.post("/plan/:id/status", write, async c => {
    const v = parse(z.object({ status: z.enum(["taught", "missed", "planned"]) }), await body(c));
    return c.json({ data: await setPlanStatus(runtime, org(c), c.req.param("id"), v.status) });
  });

  return r;
}
