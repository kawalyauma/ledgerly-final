import type { Pool, PoolClient } from "pg";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";
import { createId } from "../core-identity/security.js";
import { evaluateArithmetic, groupFor, normalizeStem } from "./signature.js";

type Db = Pool | PoolClient;

export const QUESTION_KINDS = ["computation", "short_answer", "multiple_choice", "fill_blank", "true_false", "matching", "structured", "essay", "drawing"] as const;
export const COGNITIVE_LEVELS = ["remember", "understand", "apply", "analyse", "evaluate", "create"] as const;

export type NewQuestion = {
  organizationId: string;
  classId?: string | null; subjectId?: string | null; termId?: string | null; schemeId?: string | null; lessonId?: string | null;
  stem: string; answer?: string | null; options?: string[] | null; kind?: string | null;
  concept?: string | null; skill?: string | null; difficulty?: number | null; cognitiveLevel?: string | null;
  topic?: string | null; subtopic?: string | null;
  origin: "elibrary" | "capture"; sourceChunkId?: string | null; capturePageId?: string | null; sourceQuote?: string | null; verified: boolean;
};

/** Adds a question to the bank (or returns the existing copy) and files it under its group. */
export async function addQuestion(db: Db, q: NewQuestion): Promise<{ id: string; groupId: string; created: boolean }> {
  const stem = q.stem.trim().slice(0, 2000);
  if (stem.length < 2) throw new Error("Question text is empty.");
  const g = groupFor({ stem, concept: q.concept, skill: q.skill });
  // Computation answers are worked out, not taken on trust.
  let answer = q.answer?.trim() || null;
  if (g.kind === "computation" && !g.signature.includes("_")) {
    const computed = evaluateArithmetic(g.normalized.replace(/^(work out|calculate|find|simplify|evaluate|what is):?/, ""));
    if (computed !== null) answer = String(computed);
  }
  const group = await db.query<{ id: string }>(
    `INSERT INTO lrn_question_groups(id,organization_id,subject_id,class_id,group_key,label,concept,skill)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(organization_id,subject_id,class_id,group_key) DO UPDATE SET label=lrn_question_groups.label
     RETURNING id`,
    [createId("lqg"), q.organizationId, q.subjectId ?? null, q.classId ?? null, g.groupKey, g.label, q.concept ?? null, q.skill ?? null]);
  const groupId = group.rows[0]!.id;
  const kind = (QUESTION_KINDS as readonly string[]).includes(q.kind ?? "") ? q.kind : (g.kind ?? "short_answer");
  const level = (COGNITIVE_LEVELS as readonly string[]).includes(q.cognitiveLevel ?? "") ? q.cognitiveLevel : null;
  const difficulty = q.difficulty && q.difficulty >= 1 && q.difficulty <= 5 ? Math.round(q.difficulty) : g.difficulty;
  const inserted = await db.query<{ id: string; created: boolean }>(
    `INSERT INTO lrn_questions(id,organization_id,class_id,subject_id,term_id,scheme_id,lesson_id,group_id,stem,stem_normalized,answer,options,kind,
       structure_signature,difficulty,cognitive_level,topic,subtopic,origin,source_chunk_id,capture_page_id,source_quote,verified)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     ON CONFLICT(organization_id,class_id,subject_id,stem_normalized) DO UPDATE
       SET answer=COALESCE(lrn_questions.answer,EXCLUDED.answer),verified=lrn_questions.verified OR EXCLUDED.verified,
           lesson_id=COALESCE(lrn_questions.lesson_id,EXCLUDED.lesson_id),term_id=COALESCE(lrn_questions.term_id,EXCLUDED.term_id)
     RETURNING id,(xmax=0) AS created`,
    [createId("lq"), q.organizationId, q.classId ?? null, q.subjectId ?? null, q.termId ?? null, q.schemeId ?? null, q.lessonId ?? null, groupId,
      stem, g.normalized, answer, q.options?.length ? JSON.stringify(q.options.slice(0, 10)) : null, kind, g.signature, difficulty, level,
      q.topic ?? null, q.subtopic ?? null, q.origin, q.sourceChunkId ?? null, q.capturePageId ?? null, q.sourceQuote?.slice(0, 1000) ?? null, q.verified]);
  const row = inserted.rows[0]!;
  if (row.created) await db.query("UPDATE lrn_question_groups SET question_count=question_count+1 WHERE id=$1", [groupId]);
  return { id: row.id, groupId, created: row.created };
}

const questionColumns = `q.id,q.stem,q.answer,q.options,q.kind,q.difficulty,q.cognitive_level AS "cognitiveLevel",q.topic,q.subtopic,
  q.origin,q.verified,q.source_quote AS "sourceQuote",q.group_id AS "groupId",g.label AS "groupLabel",q.class_id AS "classId",
  q.subject_id AS "subjectId",q.term_id AS "termId",q.lesson_id AS "lessonId",q.times_given AS "timesGiven",
  src.title AS "sourceTitle",src.page_url AS "sourceUrl",q.capture_page_id AS "capturePageId"`;
const questionJoins = `LEFT JOIN lrn_question_groups g ON g.id=q.group_id
  LEFT JOIN lrn_source_chunks ch ON ch.id=q.source_chunk_id LEFT JOIN lrn_sources src ON src.id=ch.source_id`;

export async function listQuestions(runtime: Runtime, organizationId: string, f: {
  classId?: string; subjectId?: string; termId?: string; groupId?: string; lessonId?: string; q?: string; origin?: string; page: number; pageSize: number;
}) {
  const where = ["q.organization_id=$1", "q.status='active'"];
  const params: unknown[] = [organizationId];
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.classId) add("q.class_id=?", f.classId);
  if (f.subjectId) add("q.subject_id=?", f.subjectId);
  if (f.termId) add("q.term_id=?", f.termId);
  if (f.groupId) add("q.group_id=?", f.groupId);
  if (f.lessonId) add("q.lesson_id=?", f.lessonId);
  if (f.origin) add("q.origin=?", f.origin);
  if (f.q) add("q.stem_normalized ILIKE ?", `%${normalizeStem(f.q).replace(/[%_]/g, "")}%`);
  const filter = where.join(" AND ");
  const [rows, total] = await Promise.all([
    runtime.db.query(`SELECT ${questionColumns} FROM lrn_questions q ${questionJoins} WHERE ${filter}
      ORDER BY q.topic NULLS LAST,g.label,q.difficulty NULLS LAST,q.created_at LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, params),
    runtime.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lrn_questions q WHERE ${filter}`, params),
  ]);
  return { items: rows.rows, total: total.rows[0]?.n ?? 0, page: f.page, pageSize: f.pageSize };
}

export async function listGroups(runtime: Runtime, organizationId: string, f: { classId?: string; subjectId?: string; termId?: string }) {
  const rows = await runtime.db.query(
    `SELECT g.id,g.label,g.concept,g.skill,g.group_key AS "groupKey",count(q.id)::int AS questions,
            min(q.difficulty) AS "minDifficulty",max(q.difficulty) AS "maxDifficulty",
            count(a.id)::int AS attempts,
            round(100.0*count(a.id) FILTER (WHERE a.outcome='correct')/NULLIF(count(a.id) FILTER (WHERE a.outcome IN ('correct','partial','incorrect')),0))::int AS "accuracyPct"
       FROM lrn_question_groups g
       JOIN lrn_questions q ON q.group_id=g.id AND q.status='active' AND ($3::text IS NULL OR q.term_id=$3)
       LEFT JOIN lrn_student_attempts a ON a.question_id=q.id
      WHERE g.organization_id=$1 AND ($2::text IS NULL OR g.class_id=$2) AND ($4::text IS NULL OR g.subject_id=$4)
      GROUP BY g.id ORDER BY g.label`, [organizationId, f.classId ?? null, f.termId ?? null, f.subjectId ?? null]);
  return rows.rows;
}

/**
 * Compares a question (from the bank, or typed in) with the bank: questions of the same structure/concept,
 * near-identical wording, and how learners have done on that group.
 */
export async function compareQuestion(runtime: Runtime, organizationId: string, input: { questionId?: string; stem?: string; classId?: string; subjectId?: string; concept?: string; skill?: string }) {
  let stem = input.stem, classId = input.classId ?? null, subjectId = input.subjectId ?? null, excludeId: string | null = null;
  if (input.questionId) {
    const q = await runtime.db.query<{ stem: string; classId: string | null; subjectId: string | null }>(
      `SELECT stem,class_id AS "classId",subject_id AS "subjectId" FROM lrn_questions WHERE id=$1 AND organization_id=$2`, [input.questionId, organizationId]);
    if (!q.rows[0]) throw new AppError(404, "NOT_FOUND", "Question not found");
    ({ stem, classId, subjectId } = q.rows[0]);
    excludeId = input.questionId;
  }
  if (!stem?.trim()) throw new AppError(422, "VALIDATION_ERROR", "Give a question or its text");
  const g = groupFor({ stem, concept: input.concept, skill: input.skill });
  const [sameGroup, similar, performance] = await Promise.all([
    runtime.db.query(
      `SELECT ${questionColumns} FROM lrn_questions q ${questionJoins}
        WHERE q.organization_id=$1 AND q.status='active' AND g.group_key=$2 AND ($3::text IS NULL OR q.class_id=$3)
          AND ($4::text IS NULL OR q.subject_id=$4) AND q.id IS DISTINCT FROM $5
        ORDER BY q.difficulty NULLS LAST,q.times_given,q.created_at LIMIT 30`, [organizationId, g.groupKey, classId, subjectId, excludeId]),
    runtime.db.query(
      `SELECT ${questionColumns},round(similarity(q.stem_normalized,$2)::numeric,2) AS similarity FROM lrn_questions q ${questionJoins}
        WHERE q.organization_id=$1 AND q.status='active' AND q.stem_normalized % $2 AND ($3::text IS NULL OR q.subject_id=$3)
          AND q.id IS DISTINCT FROM $4 AND g.group_key IS DISTINCT FROM $5
        ORDER BY similarity DESC LIMIT 15`, [organizationId, g.normalized, subjectId, excludeId, g.groupKey]),
    runtime.db.query(
      `SELECT count(a.id)::int AS attempts,count(a.id) FILTER (WHERE a.outcome='correct')::int AS correct,
              count(DISTINCT a.student_id)::int AS learners
         FROM lrn_student_attempts a JOIN lrn_questions q ON q.id=a.question_id JOIN lrn_question_groups g ON g.id=q.group_id
        WHERE a.organization_id=$1 AND g.group_key=$2 AND ($3::text IS NULL OR q.class_id=$3)`, [organizationId, g.groupKey, classId]),
  ]);
  const exists = await runtime.db.query<{ id: string }>(
    `SELECT id FROM lrn_questions WHERE organization_id=$1 AND stem_normalized=$2 AND ($3::text IS NULL OR class_id=$3) LIMIT 1`, [organizationId, g.normalized, classId]);
  return {
    question: { stem, normalized: g.normalized, group: { key: g.groupKey, label: g.label }, difficulty: g.difficulty, alreadyInBank: exists.rows[0]?.id ?? null },
    sameGroup: sameGroup.rows,
    similarWording: similar.rows,
    performance: performance.rows[0],
  };
}

/** Other questions to give learners: same group, least used first, skipping ones a given learner has already done. */
export async function alternatives(runtime: Runtime, organizationId: string, questionId: string, options: { count: number; studentId?: string; harder?: boolean }) {
  const base = await runtime.db.query<{ groupId: string; difficulty: number | null }>(
    `SELECT group_id AS "groupId",difficulty FROM lrn_questions WHERE id=$1 AND organization_id=$2`, [questionId, organizationId]);
  if (!base.rows[0]) throw new AppError(404, "NOT_FOUND", "Question not found");
  const rows = await runtime.db.query(
    `SELECT ${questionColumns} FROM lrn_questions q ${questionJoins}
      WHERE q.organization_id=$1 AND q.group_id=$2 AND q.id<>$3 AND q.status='active'
        AND ($4::text IS NULL OR NOT EXISTS (SELECT 1 FROM lrn_student_attempts a WHERE a.question_id=q.id AND a.student_id=$4))
        AND (NOT $6 OR q.difficulty >= COALESCE($7, 1))
      ORDER BY q.times_given, random() LIMIT $5`,
    [organizationId, base.rows[0].groupId, questionId, options.studentId ?? null, options.count, Boolean(options.harder), base.rows[0].difficulty]);
  return rows.rows;
}

/**
 * Builds an exercise from the bank. For a learner it focuses on their weakest groups first.
 * Questions are only ever drawn from the bank, so every one traces back to a resource or a scanned book.
 */
export async function practiceSet(runtime: Runtime, organizationId: string, input: {
  classId: string; subjectId?: string; termId?: string; lessonId?: string; groupIds?: string[]; studentId?: string; count: number; markGiven?: boolean;
}) {
  let groupIds = input.groupIds ?? [];
  if (!groupIds.length && input.studentId) {
    const weak = await runtime.db.query<{ groupId: string }>(
      `SELECT q.group_id AS "groupId" FROM lrn_student_attempts a JOIN lrn_questions q ON q.id=a.question_id
        WHERE a.organization_id=$1 AND a.student_id=$2 AND a.outcome IN ('correct','partial','incorrect') AND ($3::text IS NULL OR q.subject_id=$3)
        GROUP BY q.group_id HAVING count(*)>=2 AND avg(CASE WHEN a.outcome='correct' THEN 1 WHEN a.outcome='partial' THEN 0.5 ELSE 0 END) < 0.6
        ORDER BY avg(CASE WHEN a.outcome='correct' THEN 1 WHEN a.outcome='partial' THEN 0.5 ELSE 0 END) LIMIT 5`,
      [organizationId, input.studentId, input.subjectId ?? null]);
    groupIds = weak.rows.map(r => r.groupId);
  }
  const rows = await runtime.db.query<{ id: string; groupId: string }>(
    `SELECT * FROM (
       SELECT ${questionColumns},row_number() OVER (PARTITION BY q.group_id ORDER BY q.times_given,random()) AS rn
         FROM lrn_questions q ${questionJoins}
        WHERE q.organization_id=$1 AND q.class_id=$2 AND q.status='active' AND ($3::text IS NULL OR q.subject_id=$3)
          AND ($4::text IS NULL OR q.term_id=$4) AND ($5::text IS NULL OR q.lesson_id=$5)
          AND (cardinality($6::text[])=0 OR q.group_id=ANY($6::text[]))
          AND ($7::text IS NULL OR NOT EXISTS (SELECT 1 FROM lrn_student_attempts a WHERE a.question_id=q.id AND a.student_id=$7))
     ) x ORDER BY rn,"difficulty" NULLS LAST LIMIT $8`,
    [organizationId, input.classId, input.subjectId ?? null, input.termId ?? null, input.lessonId ?? null, groupIds, input.studentId ?? null, input.count]);
  if (input.markGiven && rows.rows.length)
    await runtime.db.query("UPDATE lrn_questions SET times_given=times_given+1 WHERE id=ANY($1::text[])", [rows.rows.map(r => r.id)]);
  return { focusGroups: groupIds, questions: rows.rows.map(({ rn: _rn, ...q }: Record<string, unknown>) => q) };
}
