import { z } from "zod";
import { createId } from "../../core-identity/security.js";
import { ulibtech } from "../../school-management/ulibtech.js";
import { assertSchoolRecords, saveScheme } from "./academics-tools.js";
import { defineTool, type LedgerlyAiToolDefinition } from "./types.js";

function schema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const slug = z.string().trim().min(1).max(240).regex(/^[a-z0-9][a-z0-9-]*$/i);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const text = (max = 4000) => z.string().trim().max(max).nullable().optional();

const elibrarySearch = defineTool({
  name: "elibrary.search",
  category: "academics",
  description:
    "Search the school e-library (ULibTech / notesug.com: Ugandan past papers, notes, schemes of work, lesson plans, curricula, revision material). " +
    "Use slugs from the taxonomy, e.g. class 'p5' or 's2', subject 'science' or 'social-studies', type 'schemes-of-work', 'lesson-plans', 'notes', 'curriculum', term 'term-3'. " +
    "Returns resource slugs to pass to elibrary.read_resource.",
  inputSchema: z.object({
    query: z.string().trim().max(200).optional(),
    classSlug: slug.optional(),
    subjectSlug: slug.optional(),
    typeSlug: slug.optional(),
    termSlug: slug.optional(),
    page: z.number().int().min(1).max(50).optional(),
  }),
  inputJsonSchema: schema({
    query: { type: "string", description: "Free-text search, e.g. 'P5 science term 3 scheme of work'" },
    classSlug: { type: "string" },
    subjectSlug: { type: "string" },
    typeSlug: { type: "string" },
    termSlug: { type: "string" },
    page: { type: "integer", minimum: 1, maximum: 50 },
  }),
  requiredScopes: ["school:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const result = await ulibtech(ctx.runtime).search({
      q: input.query, class: input.classSlug, subject: input.subjectSlug, type: input.typeSlug, term: input.termSlug,
      page: input.page ?? 1, pageSize: 12,
    });
    return {
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
      didYouMean: result.didYouMean,
      resources: result.items.map(item => ({
        slug: item.slug, title: item.title, type: item.type, className: item.className, subject: item.subject, term: item.term,
        pageCount: item.pageCount, description: item.description, pageUrl: item.pageUrl,
      })),
    };
  },
});

const elibraryRead = defineTool({
  name: "elibrary.read_resource",
  category: "academics",
  description:
    "Read the full text of an e-library resource (from elibrary.search) to ground schemes of work and lesson plans in real Ugandan curriculum material. " +
    "Long documents are returned in windows: call again with nextOffset to continue. Cite the resource title when you use it.",
  inputSchema: z.object({
    slug,
    offset: z.number().int().min(0).max(5_000_000).optional(),
    maxChars: z.number().int().min(1000).max(60_000).optional(),
  }),
  inputJsonSchema: schema({
    slug: { type: "string" },
    offset: { type: "integer", minimum: 0 },
    maxChars: { type: "integer", minimum: 1000, maximum: 60000 },
  }, ["slug"]),
  requiredScopes: ["school:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const library = ulibtech(ctx.runtime);
    const content = await library.text(input.slug);
    const offset = input.offset ?? 0, size = input.maxChars ?? 30_000;
    const window = content.text.slice(offset, offset + size);
    const end = offset + window.length;
    return {
      resource: { ...content.resource, ...library.links(input.slug) },
      offset,
      text: window,
      nextOffset: end < content.text.length ? end : null,
      totalChars: content.totalChars,
      truncatedAtSource: content.truncated,
    };
  },
});

const elibraryShelf = defineTool({
  name: "elibrary.shelf.list",
  category: "academics",
  description: "List e-library resources this school has saved to its shelf, optionally for one class or subject. Prefer these when the school has chosen them.",
  inputSchema: z.object({ classId: z.string().max(160).optional(), subjectId: z.string().max(160).optional() }),
  inputJsonSchema: schema({ classId: { type: "string" }, subjectId: { type: "string" } }),
  requiredScopes: ["school:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const rows = await ctx.runtime.db.query(
      `SELECT resource_slug AS slug,title,resource_type AS type,class_name AS "className",subject_name AS subject,term_name AS term,
              class_id AS "classId",subject_id AS "subjectId",note
         FROM school_elibrary_shelf
        WHERE organization_id=$1 AND ($2::text IS NULL OR class_id=$2) AND ($3::text IS NULL OR subject_id=$3)
        ORDER BY created_at DESC LIMIT 100`,
      [ctx.principal.organizationId, input.classId ?? null, input.subjectId ?? null],
    );
    return { resources: rows.rows };
  },
});

const academicSetup = defineTool({
  name: "academics.setup.lookup",
  category: "academics",
  description: "Look up this school's academic years, terms, classes, streams, subjects and teachers with their IDs. Call this before creating a scheme of work or lesson plan.",
  inputSchema: z.object({}),
  inputJsonSchema: schema({}),
  requiredScopes: ["school:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx) {
    const org = ctx.principal.organizationId;
    const [years, terms, classes, streams, subjects, teachers] = await Promise.all([
      ctx.runtime.db.query(`SELECT id,name,is_current AS "isCurrent" FROM school_academic_years WHERE organization_id=$1 ORDER BY is_current DESC,name DESC LIMIT 10`, [org]),
      ctx.runtime.db.query(`SELECT id,academic_year_id AS "academicYearId",name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",is_current AS "isCurrent" FROM school_terms WHERE organization_id=$1 ORDER BY starts_on DESC LIMIT 12`, [org]),
      ctx.runtime.db.query(`SELECT id,name,academic_year_id AS "academicYearId" FROM school_classes WHERE organization_id=$1 AND active=true ORDER BY name`, [org]),
      ctx.runtime.db.query(`SELECT id,class_id AS "classId",name FROM school_streams WHERE organization_id=$1 ORDER BY name`, [org]),
      ctx.runtime.db.query(`SELECT id,name,short_name AS "shortName" FROM school_subjects WHERE organization_id=$1 AND active=true ORDER BY name`, [org]),
      ctx.runtime.db.query(`SELECT id,concat_ws(' ',COALESCE(NULLIF(preferred_name,''),first_name),last_name) AS name FROM school_staff_profiles
        WHERE organization_id=$1 AND is_teacher=true AND employment_status='active' AND deleted_at IS NULL ORDER BY first_name LIMIT 200`, [org]),
    ]);
    return { academicYears: years.rows, terms: terms.rows, classes: classes.rows, streams: streams.rows, subjects: subjects.rows, teachers: teachers.rows };
  },
});

const lessonSchema = z.object({
  title: z.string().trim().min(1).max(300),
  subtopic: text(300),
  learningOutcomes: text(),
  teachingMethods: text(2000),
  learningResources: text(2000),
  assessmentStrategy: text(2000),
});

const schemeCreate = defineTool({
  name: "academics.scheme.create",
  category: "academics",
  description:
    "Create a draft scheme of work with topics and lessons for a class and subject, usually composed from e-library material (elibrary.read_resource) and the school's term. " +
    "Get IDs from academics.setup.lookup first. Do not invent IDs. The scheme is saved as a draft for the teacher to review and submit.",
  inputSchema: z.object({
    academicYearId: z.string().min(1).max(160),
    termId: z.string().min(1).max(160),
    classId: z.string().min(1).max(160),
    subjectId: z.string().min(1).max(160),
    streamId: z.string().max(160).nullable().optional(),
    teacherStaffId: z.string().max(160).nullable().optional(),
    title: z.string().trim().max(300).nullable().optional(),
    sourceSlugs: z.array(slug).max(10).optional(),
    topics: z.array(z.object({
      title: z.string().trim().min(1).max(300),
      theme: text(300),
      weekFrom: z.number().int().min(1).max(20).nullable().optional(),
      weekTo: z.number().int().min(1).max(20).nullable().optional(),
      lessons: z.array(lessonSchema).max(60),
    })).min(1).max(40),
  }),
  inputJsonSchema: schema({
    academicYearId: { type: "string" },
    termId: { type: "string" },
    classId: { type: "string" },
    subjectId: { type: "string" },
    streamId: { type: ["string", "null"] },
    teacherStaffId: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    sourceSlugs: { type: "array", items: { type: "string" }, description: "E-library resources the content was drawn from" },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          theme: { type: ["string", "null"] },
          weekFrom: { type: ["integer", "null"] },
          weekTo: { type: ["integer", "null"] },
          lessons: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                subtopic: { type: ["string", "null"] },
                learningOutcomes: { type: ["string", "null"] },
                teachingMethods: { type: ["string", "null"] },
                learningResources: { type: ["string", "null"] },
                assessmentStrategy: { type: ["string", "null"] },
              },
              required: ["title"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "lessons"],
        additionalProperties: false,
      },
    },
  }, ["academicYearId", "termId", "classId", "subjectId", "topics"]),
  requiredScopes: ["school:write"],
  riskLevel: "medium",
  approvalRequired: true,
  mutating: true,
  async execute(ctx, input) {
    await assertSchoolRecords(ctx, input);
    const saved = await saveScheme(ctx, input, input.topics, "The scheme needs at least one topic with a title.");
    return { ...saved, status: "draft", sources: input.sourceSlugs ?? [] };
  },
});

const lessonPlanCreate = defineTool({
  name: "academics.lesson_plan.create",
  category: "academics",
  description:
    "Create a draft lesson plan for one lesson (class, subject, date), usually grounded in e-library material and the class scheme of work. " +
    "Get IDs from academics.setup.lookup. Saved as a draft for the teacher to review and submit for approval.",
  inputSchema: z.object({
    academicYearId: z.string().min(1).max(160),
    termId: z.string().min(1).max(160),
    classId: z.string().min(1).max(160),
    subjectId: z.string().min(1).max(160),
    streamId: z.string().max(160).nullable().optional(),
    teacherStaffId: z.string().max(160).nullable().optional(),
    lessonDate: day,
    startsAt: time.nullable().optional(),
    endsAt: time.nullable().optional(),
    topic: z.string().trim().min(1).max(300),
    subtopic: text(300),
    competency: text(1000),
    learningOutcomes: z.string().trim().min(1).max(4000),
    priorKnowledge: text(),
    teachingMethods: text(2000),
    learningResources: text(2000),
    introduction: text(),
    lessonDevelopment: text(8000),
    assessment: text(),
    conclusion: text(),
    differentiation: text(),
    homework: text(2000),
  }),
  inputJsonSchema: schema({
    academicYearId: { type: "string" },
    termId: { type: "string" },
    classId: { type: "string" },
    subjectId: { type: "string" },
    streamId: { type: ["string", "null"] },
    teacherStaffId: { type: ["string", "null"] },
    lessonDate: { type: "string", format: "date" },
    startsAt: { type: ["string", "null"], description: "HH:MM" },
    endsAt: { type: ["string", "null"], description: "HH:MM" },
    topic: { type: "string" },
    subtopic: { type: ["string", "null"] },
    competency: { type: ["string", "null"] },
    learningOutcomes: { type: "string" },
    priorKnowledge: { type: ["string", "null"] },
    teachingMethods: { type: ["string", "null"] },
    learningResources: { type: ["string", "null"] },
    introduction: { type: ["string", "null"] },
    lessonDevelopment: { type: ["string", "null"] },
    assessment: { type: ["string", "null"] },
    conclusion: { type: ["string", "null"] },
    differentiation: { type: ["string", "null"] },
    homework: { type: ["string", "null"] },
  }, ["academicYearId", "termId", "classId", "subjectId", "lessonDate", "topic", "learningOutcomes"]),
  requiredScopes: ["school:write"],
  riskLevel: "medium",
  approvalRequired: true,
  mutating: true,
  async execute(ctx, input) {
    await assertSchoolRecords(ctx, input);
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw new Error("The lesson must end after it starts.");
    const id = createId("lp");
    await ctx.runtime.db.query(
      `INSERT INTO school_lesson_plans(id,organization_id,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_staff_id,lesson_date,starts_at,ends_at,
         topic,subtopic,competency,learning_outcomes,prior_knowledge,teaching_methods,learning_resources,introduction,lesson_development,assessment,conclusion,
         differentiation,homework,status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'draft',$25)`,
      [id, ctx.principal.organizationId, input.academicYearId, input.termId, input.classId, input.streamId ?? null, input.subjectId, input.teacherStaffId ?? null,
        input.lessonDate, input.startsAt ?? null, input.endsAt ?? null, input.topic, input.subtopic ?? null, input.competency ?? null, input.learningOutcomes,
        input.priorKnowledge ?? null, input.teachingMethods ?? null, input.learningResources ?? null, input.introduction ?? null, input.lessonDevelopment ?? null,
        input.assessment ?? null, input.conclusion ?? null, input.differentiation ?? null, input.homework ?? null, ctx.principal.userId],
    );
    return { lessonPlanId: id, status: "draft", lessonDate: input.lessonDate, topic: input.topic };
  },
});

export const elibraryTools: LedgerlyAiToolDefinition[] = [elibrarySearch, elibraryRead, elibraryShelf, academicSetup, schemeCreate, lessonPlanCreate];
