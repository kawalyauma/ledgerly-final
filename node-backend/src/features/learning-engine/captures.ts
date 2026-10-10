import { createHash } from "node:crypto";
import { z } from "zod";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";
import { createId } from "../core-identity/security.js";
import { enqueueTask, onTaskFailed, registerTaskHandler } from "./engine.js";
import { addQuestion, QUESTION_KINDS } from "./questions.js";
import { evaluateArithmetic, groupFor } from "./signature.js";

export const MAX_PAGE_BYTES = 15 * 1024 * 1024;
export const PAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export const createBatchSchema = z.object({
  kind: z.enum(["student_books", "lesson_plan_book", "teacher_notes", "exam_scripts"]),
  classId: z.string().max(160).nullish(),
  streamId: z.string().max(160).nullish(),
  subjectId: z.string().max(160).nullish(),
  termId: z.string().max(160).nullish(),
  teacherStaffId: z.string().max(160).nullish(),
  capturedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  title: z.string().trim().max(200).nullish(),
  deviceId: z.string().trim().max(120).nullish(),
});

export async function createBatch(runtime: Runtime, organizationId: string, userId: string, input: z.infer<typeof createBatchSchema>) {
  for (const [table, id] of [["school_classes", input.classId], ["school_streams", input.streamId], ["school_subjects", input.subjectId],
    ["school_terms", input.termId], ["school_staff_profiles", input.teacherStaffId]] as const) {
    if (id && !(await runtime.db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`, [id, organizationId])).rowCount)
      throw new AppError(404, "NOT_FOUND", `${table.replace("school_", "").replace(/_/g, " ")} not found in this school`);
  }
  // Default to the school's current term so batches line up with the term's question bank.
  const termId = input.termId ?? (await runtime.db.query<{ id: string }>(
    `SELECT id FROM school_terms WHERE organization_id=$1 ORDER BY is_current DESC,starts_on DESC LIMIT 1`, [organizationId])).rows[0]?.id ?? null;
  const id = createId("lbat");
  await runtime.db.query(
    `INSERT INTO lrn_capture_batches(id,organization_id,kind,class_id,stream_id,subject_id,term_id,teacher_staff_id,captured_on,title,device_id,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::date,CURRENT_DATE),$10,$11,$12)`,
    [id, organizationId, input.kind, input.classId ?? null, input.streamId ?? null, input.subjectId ?? null, termId, input.teacherStaffId ?? null,
      input.capturedOn ?? null, input.title ?? null, input.deviceId ?? null, userId]);
  return getBatch(runtime, organizationId, id);
}

export async function getBatch(runtime: Runtime, organizationId: string, id: string) {
  const batch = await runtime.db.query(
    `SELECT b.id,b.kind,b.class_id AS "classId",c.name AS "className",b.stream_id AS "streamId",b.subject_id AS "subjectId",s.name AS "subjectName",
            b.term_id AS "termId",b.captured_on::text AS "capturedOn",b.title,b.device_id AS "deviceId",b.status,b.page_count AS "pageCount",b.created_at AS "createdAt"
       FROM lrn_capture_batches b LEFT JOIN school_classes c ON c.id=b.class_id LEFT JOIN school_subjects s ON s.id=b.subject_id
      WHERE b.id=$1 AND b.organization_id=$2`, [id, organizationId]);
  if (!batch.rows[0]) throw new AppError(404, "NOT_FOUND", "Scan batch not found");
  const pages = await runtime.db.query(
    `SELECT p.id,p.client_page_id AS "clientPageId",p.seq,p.status,p.page_type AS "pageType",p.written_name AS "writtenName",p.student_id AS "studentId",
            NULLIF(concat_ws(' ',st.first_name,st.last_name),'') AS "studentName",p.student_match AS "studentMatch",p.error,p.analyzed_at AS "analyzedAt"
       FROM lrn_capture_pages p LEFT JOIN school_students st ON st.id=p.student_id WHERE p.batch_id=$1 ORDER BY p.seq`, [id]);
  const counts = pages.rows.reduce((acc: Record<string, number>, p: { status: string }) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});
  return { ...batch.rows[0], counts, pages: pages.rows };
}

/** Idempotent page upload for the scanner app: re-sending the same clientPageId returns the stored page. */
export async function addPage(runtime: Runtime, organizationId: string, batchId: string, input: {
  clientPageId: string; seq?: number; studentId?: string | null; bytes: Uint8Array; mimeType: string; analyze: boolean; requestedBy: string;
}) {
  const batch = await runtime.db.query<{ status: string; classId: string | null }>(
    `SELECT status,class_id AS "classId" FROM lrn_capture_batches WHERE id=$1 AND organization_id=$2`, [batchId, organizationId]);
  if (!batch.rows[0]) throw new AppError(404, "NOT_FOUND", "Scan batch not found");
  if (batch.rows[0].status === "cancelled") throw new AppError(409, "BATCH_CLOSED", "This scan batch was cancelled");
  const existing = await runtime.db.query(`SELECT id,status,seq FROM lrn_capture_pages WHERE batch_id=$1 AND client_page_id=$2`, [batchId, input.clientPageId]);
  if (existing.rows[0]) return { ...existing.rows[0], duplicateUpload: true };
  if (!PAGE_MIME.has(input.mimeType)) throw new AppError(415, "UNSUPPORTED_IMAGE", "Pages must be JPEG, PNG or WebP images");
  if (!input.bytes.byteLength || input.bytes.byteLength > MAX_PAGE_BYTES) throw new AppError(413, "PAGE_TOO_LARGE", "Each page must be under 15 MB");
  if (input.studentId && !(await runtime.db.query(`SELECT 1 FROM school_students WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [input.studentId, organizationId])).rowCount)
    throw new AppError(404, "NOT_FOUND", "Learner not found in this school");

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const duplicate = await runtime.db.query<{ id: string }>(
    `SELECT id FROM lrn_capture_pages WHERE organization_id=$1 AND sha256=$2 AND status<>'duplicate' LIMIT 1`, [organizationId, sha256]);
  const id = createId("lpg");
  const ext = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
  const objectKey = `learning/${organizationId}/scans/${batchId}/${id}.${ext}`;
  await runtime.storage.put(objectKey, input.bytes, input.mimeType);
  const status = duplicate.rows[0] ? "duplicate" : input.analyze ? "queued" : "uploaded";
  try {
    const inserted = await runtime.db.query<{ seq: number }>(
      `INSERT INTO lrn_capture_pages(id,organization_id,batch_id,client_page_id,seq,object_key,mime_type,size_bytes,sha256,student_id,student_match,status,error)
       VALUES($1,$2,$3,$4,COALESCE($5,(SELECT COALESCE(max(seq),0)+1 FROM lrn_capture_pages WHERE batch_id=$3)),$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING seq`,
      [id, organizationId, batchId, input.clientPageId, input.seq ?? null, objectKey, input.mimeType, input.bytes.byteLength, sha256,
        input.studentId ?? null, input.studentId ? "scanner" : null, status, duplicate.rows[0] ? `Same image as page ${duplicate.rows[0].id}` : null]);
    await runtime.db.query(
      `UPDATE lrn_capture_batches SET page_count=(SELECT count(*) FROM lrn_capture_pages WHERE batch_id=$1),status=CASE WHEN status='done' THEN 'processing' ELSE status END WHERE id=$1`, [batchId]);
    if (status === "queued") await enqueueTask(runtime, organizationId, "page.analyze", id, { priority: 60, requestedBy: input.requestedBy });
    return { id, seq: inserted.rows[0]!.seq, status, duplicateOf: duplicate.rows[0]?.id ?? null };
  } catch (error) {
    await runtime.storage.delete(objectKey).catch(() => undefined);
    throw error;
  }
}

/** Queues every not-yet-analysed page of a batch. */
export async function submitBatch(runtime: Runtime, organizationId: string, batchId: string, userId: string) {
  const pages = await runtime.db.query<{ id: string }>(
    `UPDATE lrn_capture_pages SET status='queued',error=NULL WHERE batch_id=$1 AND organization_id=$2 AND status IN ('uploaded','failed') RETURNING id`, [batchId, organizationId]);
  for (const p of pages.rows) await enqueueTask(runtime, organizationId, "page.analyze", p.id, { priority: 60, requestedBy: userId });
  await runtime.db.query(`UPDATE lrn_capture_batches SET status='processing',closed_at=COALESCE(closed_at,CURRENT_TIMESTAMP) WHERE id=$1`, [batchId]);
  await refreshBatchStatus(runtime, batchId);
  return { batchId, queued: pages.rows.length };
}

async function refreshBatchStatus(runtime: Runtime, batchId: string) {
  await runtime.db.query(
    `UPDATE lrn_capture_batches b SET status=CASE
        WHEN b.status IN ('open','cancelled') THEN b.status
        WHEN EXISTS (SELECT 1 FROM lrn_capture_pages p WHERE p.batch_id=b.id AND p.status IN ('uploaded','queued','analyzing')) THEN 'processing'
        WHEN EXISTS (SELECT 1 FROM lrn_capture_pages p WHERE p.batch_id=b.id AND p.status IN ('needs_review','failed')) THEN 'needs_review'
        ELSE 'done' END
      WHERE b.id=$1`, [batchId]);
}

const rating = z.number().min(1).max(5).transform(v => Math.round(v)).nullish();
const pageReply = z.object({
  pageType: z.string().max(40),
  writtenName: z.string().max(200).nullish(),
  writtenDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().catch(null),
  subject: z.string().max(120).nullish(),
  topic: z.string().max(300).nullish(),
  subtopic: z.string().max(300).nullish(),
  transcript: z.string().max(20000).default(""),
  items: z.array(z.object({
    number: z.string().max(20).nullish(),
    question: z.string().min(1).max(2000),
    learnerAnswer: z.string().max(2000).nullish(),
    mark: z.enum(["tick", "cross", "half", "none"]).catch("none"),
    score: z.number().nullish(),
    maxScore: z.number().nullish(),
    correction: z.string().max(1000).nullish(),
    concept: z.string().max(200).nullish(),
    skill: z.string().max(200).nullish(),
    kind: z.string().max(40).nullish(),
    errorType: z.string().max(120).nullish(),
  })).max(80).default([]),
  handwriting: z.object({ rating, legibility: z.string().max(200).nullish(), letterFormation: z.string().max(200).nullish(),
    spacing: z.string().max(200).nullish(), lineAlignment: z.string().max(200).nullish(), notes: z.string().max(1000).nullish() }).nullish(),
  spelling: z.object({ rating, errors: z.array(z.object({ written: z.string().max(80), intended: z.string().max(80) })).max(60).default([]) }).nullish(),
  language: z.object({ language: z.string().max(60).nullish(), rating, grammarIssues: z.array(z.string().max(300)).max(30).default([]), notes: z.string().max(1000).nullish() }).nullish(),
  presentation: z.object({ rating, notes: z.string().max(1000).nullish() }).nullish(),
  teacherComments: z.array(z.string().max(500)).max(10).default([]),
  lessonPlan: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().catch(null), startsAt: z.string().regex(/^\d{2}:\d{2}$/).nullish().catch(null),
    endsAt: z.string().regex(/^\d{2}:\d{2}$/).nullish().catch(null), topic: z.string().max(300).nullish(), subtopic: z.string().max(300).nullish(),
    objectives: z.array(z.string().max(500)).max(10).default([]), activities: z.array(z.string().max(1000)).max(20).default([]),
  }).nullish(),
});
type PageAnalysis = z.infer<typeof pageReply>;

/** AI step: read one scanned page. Only what is visible on the page is recorded. */
registerTaskHandler("page.analyze", async (ctx) => {
  const { runtime, task } = ctx;
  const page = await runtime.db.query<{ id: string; objectKey: string; mimeType: string; batchId: string; kind: string; className: string | null; subjectName: string | null; capturedOn: string; status: string }>(
    `SELECT p.id,p.object_key AS "objectKey",p.mime_type AS "mimeType",p.batch_id AS "batchId",p.status,b.kind,c.name AS "className",s.name AS "subjectName",b.captured_on::text AS "capturedOn"
       FROM lrn_capture_pages p JOIN lrn_capture_batches b ON b.id=p.batch_id LEFT JOIN school_classes c ON c.id=b.class_id LEFT JOIN school_subjects s ON s.id=b.subject_id
      WHERE p.id=$1 AND p.organization_id=$2`, [task.subjectRef, task.organizationId]);
  const p = page.rows[0];
  if (!p || p.status === "duplicate") return { skipped: true };
  const bytes = await runtime.storage.get(p.objectKey);
  if (!bytes) throw new Error("The scanned image is missing from storage.");
  await runtime.db.query(`UPDATE lrn_capture_pages SET status='analyzing',error=NULL WHERE id=$1`, [p.id]);
  const book = { student_books: "a learner's exercise book", lesson_plan_book: "a teacher's lesson plan book", teacher_notes: "a teacher's notes book", exam_scripts: "a learner's exam script" }[p.kind] ?? "a school book";
  const raw = await ctx.ai({
    images: [{ name: `page.${p.mimeType.split("/")[1]}`, bytes }],
    prompt: [
      `The attached image is one scanned page of ${book}${p.className ? ` from ${p.className}` : ""}${p.subjectName ? `, ${p.subjectName}` : ""}, scanned on ${p.capturedOn}.`,
      "Read it carefully and record ONLY what is visible. Copy text exactly as written, including the learner's own spelling. Never guess unreadable words: write [illegible].",
      "- pageType: exercise | notes | test | lesson_plan | cover | blank | other",
      "- writtenName: the learner's (or teacher's) name exactly as written on the page, else null. writtenDate as YYYY-MM-DD if a date is written.",
      "- topic/subtopic: as headed on the page.",
      "- items: each question or exercise item on the page with the learner's answer and the teacher's mark (tick, cross, half, none), score if written, the teacher's correction if any.",
      "  concept = the subtopic the item tests, skill = what the learner must do. kind is one of: " + QUESTION_KINDS.join(", ") + ". errorType = the kind of mistake if the answer is marked wrong (e.g. 'carrying', 'spelling', 'misread question').",
      "- handwriting (learner pages): rating 1 (very poor) to 5 (excellent), with short notes on legibility, letter formation, spacing and line alignment.",
      "- spelling: rating 1-5 and each misspelt word as {written, intended} (only clear cases).",
      "- language: the language written, rating 1-5 for sentence construction and grammar, with the issues seen.",
      "- presentation: rating 1-5 (neatness, margins, crossing out, diagrams).",
      "- teacherComments: any remarks written by the teacher.",
      "- lessonPlan (lesson plan pages only): date, times, topic, subtopic, objectives and activities as written.",
      "",
      "Reply shape:",
      `{"pageType":string,"writtenName":string|null,"writtenDate":string|null,"subject":string|null,"topic":string|null,"subtopic":string|null,"transcript":string,` +
      `"items":[{"number":string|null,"question":string,"learnerAnswer":string|null,"mark":"tick"|"cross"|"half"|"none","score":number|null,"maxScore":number|null,"correction":string|null,"concept":string|null,"skill":string|null,"kind":string|null,"errorType":string|null}],` +
      `"handwriting":{"rating":1-5,"legibility":string,"letterFormation":string,"spacing":string,"lineAlignment":string,"notes":string}|null,"spelling":{"rating":1-5,"errors":[{"written":string,"intended":string}]}|null,` +
      `"language":{"language":string,"rating":1-5,"grammarIssues":[string],"notes":string}|null,"presentation":{"rating":1-5,"notes":string}|null,"teacherComments":[string],` +
      `"lessonPlan":{"date":string|null,"startsAt":"HH:MM"|null,"endsAt":"HH:MM"|null,"topic":string|null,"subtopic":string|null,"objectives":[string],"activities":[string]}|null}`,
    ].join("\n"),
  });
  const analysis = pageReply.parse(raw);
  await runtime.db.query(
    `UPDATE lrn_capture_pages SET analysis=$2::jsonb,transcript=$3,page_type=$4,written_name=$5,analyzed_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [p.id, JSON.stringify(analysis), analysis.transcript, analysis.pageType, analysis.writtenName ?? null]);
  const applied = await applyPageAnalysis(runtime, task.organizationId, p.id);
  await refreshBatchStatus(runtime, p.batchId);
  return applied;
});

onTaskFailed("page.analyze", async (runtime, task, message) => {
  const row = await runtime.db.query<{ batchId: string }>(
    `UPDATE lrn_capture_pages SET status='failed',error=$2 WHERE id=$1 RETURNING batch_id AS "batchId"`, [task.subjectRef, message]);
  if (row.rows[0]) await refreshBatchStatus(runtime, row.rows[0].batchId);
});

/** Finds the learner from the name written on the page, among the batch's class (or the whole school). */
async function matchStudent(runtime: Runtime, organizationId: string, classId: string | null, writtenName: string) {
  const rows = await runtime.db.query<{ id: string; score: number }>(
    `SELECT st.id,greatest(
        similarity(lower(concat_ws(' ',st.first_name,st.last_name)),lower($3)),
        similarity(lower(concat_ws(' ',st.last_name,st.first_name)),lower($3)),
        similarity(lower(concat_ws(' ',COALESCE(NULLIF(st.preferred_name,''),st.first_name),st.middle_name,st.last_name)),lower($3))) AS score
       FROM school_students st
      WHERE st.organization_id=$1 AND st.deleted_at IS NULL AND st.status NOT IN ('withdrawn','graduated','expelled')
        AND ($2::text IS NULL OR st.current_class_id=$2 OR EXISTS (SELECT 1 FROM school_enrollments e WHERE e.student_id=st.id AND e.class_id=$2))
      ORDER BY score DESC LIMIT 2`, [organizationId, classId, writtenName]);
  const [best, second] = rows.rows;
  if (!best || best.score < 0.45) return null;
  if (second && best.score - second.score < 0.12) return null;
  return { id: best.id, match: best.score >= 0.95 ? "name_exact" : "name_fuzzy" };
}

const OUTCOME = { tick: "correct", cross: "incorrect", half: "partial", none: "unmarked" } as const;

/**
 * Turns a stored page analysis into records: bank questions, the learner's attempts and observations,
 * and teaching timeline entries. Safe to re-run (e.g. after a learner is assigned by hand).
 */
export async function applyPageAnalysis(runtime: Runtime, organizationId: string, pageId: string) {
  const row = await runtime.db.query<{
    id: string; analysis: PageAnalysis; studentId: string | null; studentMatch: string | null; batchId: string; kind: string;
    classId: string | null; streamId: string | null; subjectId: string | null; termId: string | null; teacherStaffId: string | null; capturedOn: string;
  }>(
    `SELECT p.id,p.analysis,p.student_id AS "studentId",p.student_match AS "studentMatch",p.batch_id AS "batchId",b.kind,b.class_id AS "classId",b.stream_id AS "streamId",
            b.subject_id AS "subjectId",b.term_id AS "termId",b.teacher_staff_id AS "teacherStaffId",b.captured_on::text AS "capturedOn"
       FROM lrn_capture_pages p JOIN lrn_capture_batches b ON b.id=p.batch_id WHERE p.id=$1 AND p.organization_id=$2`, [pageId, organizationId]);
  const p = row.rows[0];
  if (!p?.analysis) throw new AppError(409, "PAGE_NOT_ANALYZED", "This page has not been read yet");
  const a = p.analysis;
  const learnerBook = p.kind === "student_books" || p.kind === "exam_scripts";
  let studentId = p.studentId, studentMatch = p.studentMatch;
  if (learnerBook && !studentId && a.writtenName) {
    const m = await matchStudent(runtime, organizationId, p.classId, a.writtenName);
    if (m) { studentId = m.id; studentMatch = m.match; }
  }
  const day = a.writtenDate ?? a.lessonPlan?.date ?? p.capturedOn;
  const client = await runtime.db.connect();
  let questions = 0, attempts = 0, observations = 0, events = 0;
  try {
    await client.query("BEGIN");
    // Re-running replaces this page's evidence instead of duplicating it.
    await client.query("DELETE FROM lrn_student_attempts WHERE capture_page_id=$1", [p.id]);
    await client.query("DELETE FROM lrn_student_observations WHERE capture_page_id=$1", [p.id]);
    await client.query("DELETE FROM lrn_teaching_events WHERE capture_page_id=$1", [p.id]);

    for (const item of a.items) {
      const q = await addQuestion(client, {
        organizationId, classId: p.classId, subjectId: p.subjectId, termId: p.termId, stem: item.question, kind: item.kind,
        concept: item.concept ?? a.subtopic ?? a.topic, skill: item.skill, topic: a.topic ?? null, subtopic: a.subtopic ?? null,
        answer: item.mark === "tick" ? item.learnerAnswer : item.correction, origin: "capture", capturePageId: p.id, sourceQuote: item.question, verified: true,
      });
      if (q.created) questions += 1;
      if (!learnerBook || !studentId) continue;
      let outcome: string = item.learnerAnswer?.trim() ? OUTCOME[item.mark] : "blank";
      let errorType = item.errorType ?? null;
      // Unmarked sums can be checked exactly.
      if (outcome === "unmarked") {
        const g = groupFor({ stem: item.question });
        const expected = g.kind === "computation" ? evaluateArithmetic(g.normalized) : null;
        const given = Number(item.learnerAnswer?.replace(/[^\d.-]/g, ""));
        if (expected !== null && Number.isFinite(given)) { outcome = given === expected ? "correct" : "incorrect"; errorType = errorType ?? "checked_by_engine"; }
      }
      await client.query(
        `INSERT INTO lrn_student_attempts(id,organization_id,student_id,question_id,capture_page_id,subject_id,answer_text,outcome,score,max_score,error_type,attempted_on)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [createId("latt"), organizationId, studentId, q.id, p.id, p.subjectId, item.learnerAnswer ?? null, outcome, item.score ?? null, item.maxScore ?? null, errorType, day]);
      attempts += 1;
    }

    if (learnerBook && studentId) {
      const obs: Array<[string, number | null | undefined, string | null, unknown]> = [
        ["handwriting", a.handwriting?.rating, a.handwriting?.notes ?? null, a.handwriting],
        ["spelling", a.spelling?.rating, a.spelling?.errors.length ? `${a.spelling.errors.length} misspelt word(s)` : null, a.spelling],
        ["language", a.language?.rating, a.language?.language ?? null, a.language],
        ["presentation", a.presentation?.rating, a.presentation?.notes ?? null, a.presentation],
        ...a.teacherComments.map(c => ["teacher_comment", null, c, { comment: c }] as [string, null, string, unknown]),
      ];
      for (const [dimension, value, label, details] of obs) {
        if (!details || (value == null && dimension !== "teacher_comment")) continue;
        await client.query(
          `INSERT INTO lrn_student_observations(id,organization_id,student_id,capture_page_id,subject_id,dimension,rating,label,details,observed_on)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
          [createId("lobs"), organizationId, studentId, p.id, p.subjectId, dimension, value ?? null, label?.slice(0, 300) ?? null, JSON.stringify(details), day]);
        observations += 1;
      }
    }

    const topic = a.lessonPlan?.topic ?? a.topic;
    if (p.classId && topic) {
      const inserted = await client.query(
        `INSERT INTO lrn_teaching_events(id,organization_id,class_id,stream_id,subject_id,term_id,teacher_staff_id,taught_on,starts_at,ends_at,topic,subtopic,evidence,capture_page_id,confidence)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
        [createId("ltev"), organizationId, p.classId, p.streamId, p.subjectId, p.termId, p.teacherStaffId, day, a.lessonPlan?.startsAt ?? null, a.lessonPlan?.endsAt ?? null,
          topic, a.lessonPlan?.subtopic ?? a.subtopic ?? null, p.kind === "lesson_plan_book" ? "lesson_plan_book" : "exercise_book", p.id, a.writtenDate || a.lessonPlan?.date ? 0.9 : 0.6]);
      events += inserted.rowCount ?? 0;
    }

    const needsReview = learnerBook && !studentId && !["cover", "blank"].includes(a.pageType);
    await client.query(
      `UPDATE lrn_capture_pages SET status=$2,student_id=$3,student_match=$4,error=$5 WHERE id=$1`,
      [p.id, needsReview ? "needs_review" : "analyzed", studentId, studentMatch,
        needsReview ? (a.writtenName ? `Could not match "${a.writtenName}" to one learner in the class` : "No learner name found on the page") : null]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { studentId, studentMatch, questions, attempts, observations, teachingEvents: events };
}

/** Assigns a page to a learner by hand and re-applies its stored analysis (no new AI call). */
export async function assignPageStudent(runtime: Runtime, organizationId: string, pageId: string, studentId: string) {
  if (!(await runtime.db.query(`SELECT 1 FROM school_students WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [studentId, organizationId])).rowCount)
    throw new AppError(404, "NOT_FOUND", "Learner not found in this school");
  const updated = await runtime.db.query<{ batchId: string; analyzed: boolean }>(
    `UPDATE lrn_capture_pages SET student_id=$3,student_match='manual' WHERE id=$1 AND organization_id=$2 RETURNING batch_id AS "batchId",analysis IS NOT NULL AS analyzed`,
    [pageId, organizationId, studentId]);
  if (!updated.rows[0]) throw new AppError(404, "NOT_FOUND", "Page not found");
  const result = updated.rows[0].analyzed ? await applyPageAnalysis(runtime, organizationId, pageId) : null;
  await refreshBatchStatus(runtime, updated.rows[0].batchId);
  return { pageId, studentId, applied: result };
}

export async function pageImage(runtime: Runtime, organizationId: string, pageId: string) {
  const row = await runtime.db.query<{ objectKey: string; mimeType: string }>(
    `SELECT object_key AS "objectKey",mime_type AS "mimeType" FROM lrn_capture_pages WHERE id=$1 AND organization_id=$2`, [pageId, organizationId]);
  if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Page not found");
  const bytes = await runtime.storage.get(row.rows[0].objectKey);
  if (!bytes) throw new AppError(404, "NOT_FOUND", "The page image is missing");
  return { bytes, mimeType: row.rows[0].mimeType };
}

export async function getPage(runtime: Runtime, organizationId: string, pageId: string) {
  const row = await runtime.db.query(
    `SELECT p.id,p.batch_id AS "batchId",p.seq,p.status,p.page_type AS "pageType",p.written_name AS "writtenName",p.student_id AS "studentId",
            p.student_match AS "studentMatch",p.transcript,p.analysis,p.error,p.analyzed_at AS "analyzedAt"
       FROM lrn_capture_pages p WHERE p.id=$1 AND p.organization_id=$2`, [pageId, organizationId]);
  if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Page not found");
  return row.rows[0];
}
