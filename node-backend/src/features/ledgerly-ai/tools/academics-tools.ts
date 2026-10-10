import { z } from "zod";
import { createId } from "../../core-identity/security.js";
import { extractSchemeFromDocument } from "../../academics/ocr-extract.js";
import { defineTool, type LedgerlyAiToolContext, type LedgerlyAiToolDefinition } from "./types.js";

function schema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const schemeImportFromDocument = defineTool({
  name: "academics.scheme.import_from_document",
  category: "academics",
  description:
    "Read a photographed/scanned scheme-of-work document (JPEG/PNG) the user attached and prepare a scheme with its topics and lessons for approval. Never invents content not visible in the image. If the academic year, term, class, subject or teacher is not given, this tool fails with a clear message — ask the user for it rather than guessing.",
  inputSchema: z.object({
    fileId: z.string().min(1).max(160),
    academicYearId: z.string().min(1).max(160),
    termId: z.string().min(1).max(160),
    classId: z.string().min(1).max(160),
    streamId: z.string().max(160).nullable().optional(),
    subjectId: z.string().min(1).max(160),
    teacherStaffId: z.string().max(160).nullable().optional(),
    title: z.string().trim().max(300).nullable().optional(),
  }),
  inputJsonSchema: schema({
    fileId: { type: "string" },
    academicYearId: { type: "string" },
    termId: { type: "string" },
    classId: { type: "string" },
    streamId: { type: ["string", "null"] },
    subjectId: { type: "string" },
    teacherStaffId: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
  }, ["fileId", "academicYearId", "termId", "classId", "subjectId"]),
  requiredScopes: ["school:write"],
  riskLevel: "medium",
  approvalRequired: true,
  mutating: true,
  async execute(ctx, input) {
    await assertSchoolRecords(ctx, input);
    const orgId = ctx.principal.organizationId;
    const file = await ctx.runtime.db.query<{ objectKey: string; mimeType: string; originalName: string }>(
      `SELECT object_key AS "objectKey", mime_type AS "mimeType", original_name AS "originalName" FROM school_files WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [input.fileId, orgId],
    );
    const fileRow = file.rows[0];
    if (!fileRow) throw new Error("That file was not found in this school's storage. Ask the user to re-upload it.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(fileRow.mimeType)) {
      throw new Error("Only JPEG, PNG or WebP photos/scans of a scheme are supported right now. Ask the user to upload the scheme as one of those image formats.");
    }
    const bytes = await ctx.runtime.storage.get(fileRow.objectKey);
    if (!bytes) throw new Error("The uploaded file could not be read from storage.");

    const extraction = await extractSchemeFromDocument({
      runtime: ctx.runtime, organizationId: orgId, userId: ctx.principal.userId,
      fileBytes: bytes, fileName: fileRow.originalName,
    });
    const saved = await saveScheme(ctx, { ...input, title: input.title || extraction.title }, extraction.topics,
      "The image did not contain any readable topics. Ask the user for a clearer photo, or to create the scheme manually.");
    return { ...saved, notes: extraction.notes ?? null };
  },
});

export type SchemeTarget = {
  academicYearId: string; termId: string; classId: string; subjectId: string;
  streamId?: string | null; teacherStaffId?: string | null; title?: string | null;
};
export type SchemeTopicInput = {
  title?: string | null; theme?: string | null; weekFrom?: number | null; weekTo?: number | null;
  lessons?: { title?: string | null; subtopic?: string | null; learningOutcomes?: string | null; teachingMethods?: string | null; learningResources?: string | null; assessmentStrategy?: string | null }[] | null;
}[];

/** Ensures every referenced record belongs to the caller's school before anything is written. */
export async function assertSchoolRecords(ctx: LedgerlyAiToolContext, input: Partial<SchemeTarget>) {
  const orgId = ctx.principal.organizationId;
  const owned = async (table: string, id?: string | null) => {
    if (!id) return;
    const q = await ctx.runtime.db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`, [id, orgId]);
    if (!q.rowCount) throw new Error(`${table} record does not belong to this school.`);
  };
  await owned("school_academic_years", input.academicYearId);
  await owned("school_terms", input.termId);
  await owned("school_classes", input.classId);
  await owned("school_streams", input.streamId);
  await owned("school_subjects", input.subjectId);
  await owned("school_staff_profiles", input.teacherStaffId);
}

/** Writes a scheme of work with its topics and lessons in one transaction. */
export async function saveScheme(ctx: LedgerlyAiToolContext, input: SchemeTarget, topics: SchemeTopicInput, emptyMessage: string) {
  const orgId = ctx.principal.organizationId;
  const refs = await ctx.runtime.db.query<{ subjectName: string; className: string; streamName: string | null; termName: string }>(
    `SELECT sub.name AS "subjectName", cl.name AS "className", st.name AS "streamName", tr.name AS "termName"
       FROM school_subjects sub, school_classes cl, school_terms tr
       LEFT JOIN school_streams st ON st.id=$4 AND st.organization_id=$5
      WHERE sub.id=$1 AND sub.organization_id=$5 AND cl.id=$2 AND cl.organization_id=$5 AND tr.id=$3 AND tr.organization_id=$5`,
    [input.subjectId, input.classId, input.termId, input.streamId ?? null, orgId],
  );
  const ref = refs.rows[0];
  const title = (input.title || (ref ? `${ref.subjectName} · ${ref.className}${ref.streamName ? ` · ${ref.streamName}` : ""} · ${ref.termName}` : "Imported scheme")).slice(0, 300);

  const schemeId = createId("sch");
  let topicsCreated = 0, lessonsCreated = 0;
  const client = await ctx.runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO school_schemes_of_work(id,organization_id,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_staff_id,title,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [schemeId, orgId, input.academicYearId, input.termId, input.classId, input.streamId ?? null, input.subjectId, input.teacherStaffId ?? null, title, ctx.principal.userId],
    );
    for (const topic of topics) {
      if (!topic.title?.trim()) continue;
      const topicId = createId("sct");
      await client.query(
        `INSERT INTO school_scheme_topics(id,organization_id,scheme_id,title,theme,week_from,week_to) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [topicId, orgId, schemeId, topic.title.trim().slice(0, 300), topic.theme?.trim().slice(0, 300) || null, topic.weekFrom ?? null, topic.weekTo ?? null],
      );
      topicsCreated += 1;
      let sequenceNo = 1;
      for (const lesson of topic.lessons ?? []) {
        if (!lesson.title?.trim()) continue;
        const lessonId = createId("scl");
        await client.query(
          `INSERT INTO school_scheme_lessons(id,organization_id,topic_id,sequence_no,title,subtopic,learning_outcomes,teaching_methods,learning_resources,assessment_strategy,duration_minutes)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,40)`,
          [lessonId, orgId, topicId, sequenceNo, lesson.title.trim().slice(0, 300), lesson.subtopic ?? null, lesson.learningOutcomes ?? null, lesson.teachingMethods ?? null, lesson.learningResources ?? null, lesson.assessmentStrategy ?? null],
        );
        sequenceNo += 1;
        lessonsCreated += 1;
      }
    }
    if (!topicsCreated) throw new Error(emptyMessage);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }

  return { schemeId, title, topicsCreated, lessonsCreated };
}

export const academicsTools: LedgerlyAiToolDefinition[] = [schemeImportFromDocument];
