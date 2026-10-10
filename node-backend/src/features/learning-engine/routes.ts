import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { ulibtech } from "../school-management/ulibtech.js";
import { addPage, assignPageStudent, createBatch, createBatchSchema, getBatch, getPage, pageImage, submitBatch } from "./captures.js";
import { enqueueTask, getSettings, updateSettings } from "./engine.js";
import { coverage, recordTeaching, requestStudentSummary, studentOverview, teachingAt, teachingEventSchema, timeline } from "./insights.js";
import { alternatives, compareQuestion, listGroups, listQuestions, practiceSet } from "./questions.js";
import { createScheme, createSchemeSchema, getLesson, getScheme, regenerate, setPublished } from "./schemes.js";

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

  return r;
}
