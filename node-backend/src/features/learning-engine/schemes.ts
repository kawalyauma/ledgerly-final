import { z } from "zod";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";
import { createId } from "../core-identity/security.js";
import { ulibtech } from "../school-management/ulibtech.js";
import { enqueueTask, onTaskFailed, registerTaskHandler, type TaskContext } from "./engine.js";
import { addQuestion, COGNITIVE_LEVELS, QUESTION_KINDS } from "./questions.js";
import { quoteAppearsIn } from "./signature.js";
import { formatPassages, ingestResource, openingPassages, relevantPassages, type Passage } from "./sources.js";

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

/** Maps a school's class name ("Primary Four 2026", "P6 Blue", "Senior 3") to the e-library class slug. */
export function libraryClassSlug(name: string): string | null {
  const n = name.toLowerCase();
  for (const k of ["baby", "middle", "top"]) if (n.includes(`${k} class`)) return `${k}-class`;
  const m = /\b(p|s|primary|senior)\.?\s*(\d|one|two|three|four|five|six|seven)\b/.exec(n);
  if (!m) return null;
  const num = /\d/.test(m[2]!) ? Number(m[2]) : WORDS[m[2]!];
  return `${m[1]!.startsWith("p") ? "p" : "s"}${num}`;
}

async function librarySubjectSlug(runtime: Runtime, subjectName: string): Promise<string | null> {
  const taxonomy = await ulibtech(runtime).taxonomy();
  const n = subjectName.toLowerCase().replace(/&/g, "and").trim();
  const subjects = taxonomy.subjects as Array<{ slug: string; name: string }>;
  return subjects.find(s => s.name.toLowerCase() === n)?.slug
    ?? subjects.find(s => n.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(n))?.slug
    ?? ({ maths: "mathematics", sst: "social-studies", re: "religious-education", cre: "religious-education", ire: "religious-education", ict: "ict" } as Record<string, string>)[n]
    ?? null;
}

export const createSchemeSchema = z.object({
  termId: z.string().min(1).max(160),
  classId: z.string().min(1).max(160),
  subjectId: z.string().min(1).max(160),
  title: z.string().trim().max(300).optional(),
  weeks: z.number().int().min(1).max(20).default(12),
  periodsPerWeek: z.number().int().min(1).max(20).default(5),
  /** Override the e-library class/subject/term mapping, or name the exact resources to use. */
  library: z.object({
    classSlug: z.string().max(40).optional(), subjectSlug: z.string().max(80).optional(), termSlug: z.string().max(40).optional(),
    resourceSlugs: z.array(z.string().min(1).max(240)).max(12).optional(),
  }).default({}),
});

export async function createScheme(runtime: Runtime, organizationId: string, userId: string, input: z.infer<typeof createSchemeSchema>) {
  const refs = await runtime.db.query<{ className: string; subjectName: string; termName: string; academicYearId: string | null }>(
    `SELECT c.name AS "className",s.name AS "subjectName",t.name AS "termName",t.academic_year_id AS "academicYearId"
       FROM school_classes c, school_subjects s, school_terms t
      WHERE c.id=$1 AND c.organization_id=$4 AND s.id=$2 AND s.organization_id=$4 AND t.id=$3 AND t.organization_id=$4`,
    [input.classId, input.subjectId, input.termId, organizationId]);
  const ref = refs.rows[0];
  if (!ref) throw new AppError(404, "NOT_FOUND", "Class, subject or term not found in this school");
  const termNumber = /(\d)/.exec(ref.termName)?.[1] ?? Object.entries(WORDS).find(([w]) => ref.termName.toLowerCase().includes(w))?.[1];
  const library = {
    classSlug: input.library.classSlug ?? libraryClassSlug(ref.className),
    subjectSlug: input.library.subjectSlug ?? await librarySubjectSlug(runtime, ref.subjectName).catch(() => null),
    termSlug: input.library.termSlug ?? (termNumber ? `term-${termNumber}` : null),
    resourceSlugs: input.library.resourceSlugs ?? [],
  };
  const id = createId("lsch");
  await runtime.db.query(
    `INSERT INTO lrn_schemes(id,organization_id,academic_year_id,term_id,class_id,subject_id,title,library_filters,weeks,periods_per_week,status,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'sourcing',$11)`,
    [id, organizationId, ref.academicYearId, input.termId, input.classId, input.subjectId,
      input.title || `${ref.subjectName} · ${ref.className} · ${ref.termName}`, JSON.stringify(library), input.weeks, input.periodsPerWeek, userId]);
  await enqueueTask(runtime, organizationId, "scheme.source", id, { priority: 10, requestedBy: userId });
  return { id, status: "sourcing", library };
}

type SchemeRow = {
  id: string; organizationId: string; termId: string; classId: string; subjectId: string; title: string; status: string;
  weeks: number; periodsPerWeek: number; library: { classSlug: string | null; subjectSlug: string | null; termSlug: string | null; resourceSlugs: string[] };
  className: string; subjectName: string; termName: string;
};

async function loadScheme(runtime: Runtime, organizationId: string, id: string): Promise<SchemeRow> {
  const row = await runtime.db.query<SchemeRow>(
    `SELECT sc.id,sc.organization_id AS "organizationId",sc.term_id AS "termId",sc.class_id AS "classId",sc.subject_id AS "subjectId",
            sc.title,sc.status,sc.weeks,sc.periods_per_week AS "periodsPerWeek",sc.library_filters AS library,
            c.name AS "className",s.name AS "subjectName",t.name AS "termName"
       FROM lrn_schemes sc JOIN school_classes c ON c.id=sc.class_id JOIN school_subjects s ON s.id=sc.subject_id JOIN school_terms t ON t.id=sc.term_id
      WHERE sc.id=$1 AND sc.organization_id=$2`, [id, organizationId]);
  if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Scheme not found");
  return row.rows[0];
}

const ROLE_BY_TYPE: Record<string, string> = { "schemes-of-work": "scheme", "lesson-plans": "lesson_plans", notes: "notes", "past-papers": "past_papers" };
const WANT: Array<[string, number]> = [["schemes-of-work", 2], ["lesson-plans", 2], ["notes", 3], ["past-papers", 2]];

/** Step 1 (no AI): find the class/subject material in the e-library and store its text as passages. */
registerTaskHandler("scheme.source", async ({ runtime, task }) => {
  const scheme = await loadScheme(runtime, task.organizationId, task.subjectRef);
  const library = ulibtech(runtime);
  const picked: Array<{ slug: string; role: string }> = [];
  if (scheme.library.resourceSlugs?.length) {
    for (const slug of scheme.library.resourceSlugs) picked.push({ slug, role: "reference" });
  } else {
    if (!scheme.library.classSlug || !scheme.library.subjectSlug)
      throw new Error(`Could not match ${scheme.className} / ${scheme.subjectName} to the e-library. Set the library class and subject on the scheme.`);
    for (const [type, count] of WANT) {
      // Prefer this term's material, then the whole year's.
      let items = (await library.search({ class: scheme.library.classSlug, subject: scheme.library.subjectSlug, type, term: scheme.library.termSlug ?? undefined, pageSize: count })).items;
      if (items.length < count && scheme.library.termSlug)
        items = [...items, ...(await library.search({ class: scheme.library.classSlug, subject: scheme.library.subjectSlug, type, pageSize: count })).items];
      for (const item of items) if (!picked.some(p => p.slug === item.slug) && picked.filter(p => p.role === ROLE_BY_TYPE[type]).length < count)
        picked.push({ slug: item.slug, role: ROLE_BY_TYPE[type] ?? "reference" });
    }
  }
  const ingested: Array<{ title: string; role: string; status: string; chunks: number }> = [];
  for (const p of picked) {
    try {
      const source = await ingestResource(runtime, task.organizationId, p.slug);
      if (source.status === "ready") await runtime.db.query(
        `INSERT INTO lrn_scheme_sources(scheme_id,source_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [scheme.id, source.id, p.role]);
      ingested.push({ title: source.title, role: p.role, status: source.status, chunks: source.chunkCount });
    } catch (error) {
      ingested.push({ title: p.slug, role: p.role, status: `failed: ${error instanceof Error ? error.message : String(error)}`, chunks: 0 });
    }
  }
  if (!ingested.some(s => s.status === "ready"))
    throw new Error(`No readable e-library material was found for ${scheme.subjectName}, ${scheme.className}. Pick resources for this scheme manually.`);
  await runtime.db.query(`UPDATE lrn_schemes SET status='outlining',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [scheme.id]);
  await enqueueTask(runtime, task.organizationId, "scheme.outline", scheme.id, { priority: 20, requestedBy: task.requestedBy });
  return { sources: ingested };
});

async function schemeSources(runtime: Runtime, schemeId: string) {
  const rows = await runtime.db.query<{ id: string; role: string; title: string }>(
    `SELECT s.id,ss.role,s.title FROM lrn_scheme_sources ss JOIN lrn_sources s ON s.id=ss.source_id WHERE ss.scheme_id=$1
      ORDER BY CASE ss.role WHEN 'scheme' THEN 0 WHEN 'lesson_plans' THEN 1 WHEN 'notes' THEN 2 WHEN 'reference' THEN 3 ELSE 4 END,s.title`, [schemeId]);
  return rows.rows;
}

const ids = z.array(z.string()).max(30).default([]);
const outlineReply = z.object({
  title: z.string().max(300).nullish(),
  summary: z.string().max(3000).nullish(),
  units: z.array(z.object({
    title: z.string().min(1).max(300),
    theme: z.string().max(300).nullish(),
    weekFrom: z.number().int().min(1).max(20).nullish(),
    weekTo: z.number().int().min(1).max(20).nullish(),
    competences: z.string().max(3000).nullish(),
    sourcePassageIds: ids,
    lessons: z.array(z.object({
      title: z.string().min(1).max(300),
      subtopic: z.string().max(300).nullish(),
      week: z.number().int().min(1).max(20).nullish(),
      objectives: z.array(z.string().max(500)).max(10).default([]),
      sourcePassageIds: ids,
    })).max(60),
  })).min(1).max(40),
  gaps: z.array(z.string().max(500)).max(20).default([]),
});

/** Step 2 (AI): the overall scheme, i.e. units/topics and the list of lessons, with week ranges. No lesson content yet. */
registerTaskHandler("scheme.outline", async (ctx: TaskContext) => {
  const { runtime, task, settings } = ctx;
  const scheme = await loadScheme(runtime, task.organizationId, task.subjectRef);
  const sources = await schemeSources(runtime, scheme.id);
  const primary = sources.filter(s => s.role === "scheme" || s.role === "lesson_plans" || s.role === "reference").map(s => s.id);
  const budget = Math.floor(settings.maxPromptChars * 0.85);
  let passages: Passage[] = await openingPassages(runtime, task.organizationId, primary.length ? primary : sources.map(s => s.id), budget);
  if (!passages.length) throw new Error("The scheme has no source passages to work from.");
  const allowed = new Set(passages.map(p => p.id));
  const reply = outlineReply.parse(await ctx.ai({
    prompt: [
      `Task: draft the OUTLINE of a scheme of work for ${scheme.subjectName}, ${scheme.className}, ${scheme.termName}.`,
      `The term has ${scheme.weeks} teaching weeks with ${scheme.periodsPerWeek} periods a week (at most ${scheme.weeks * scheme.periodsPerWeek} lessons).`,
      "Take the themes, topics, subtopics and their order from the passages below (they come from Ugandan schemes of work, lesson plans and notes in the school e-library).",
      `Use this term's part of the material (${scheme.termName}) when the passages cover several terms.`,
      "Do NOT write lesson content yet. Each unit and lesson must cite the passage ids it comes from in sourcePassageIds.",
      "",
      "Reply shape:",
      `{"title":string,"summary":string,"units":[{"title":string,"theme":string|null,"weekFrom":int|null,"weekTo":int|null,"competences":string|null,"sourcePassageIds":[string],"lessons":[{"title":string,"subtopic":string|null,"week":int|null,"objectives":[string],"sourcePassageIds":[string]}]}],"gaps":[string]}`,
      "",
      "<passages>",
      formatPassages(passages),
      "</passages>",
    ].join("\n"),
  }));
  // Keep only what is traceable to the passages we supplied.
  const cite = (list: string[]) => list.filter(id => allowed.has(id));
  const maxLessons = scheme.weeks * scheme.periodsPerWeek;
  let lessonSeq = 0, dropped = 0;
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM lrn_units WHERE scheme_id=$1", [scheme.id]);
    for (const [u, unit] of reply.units.entries()) {
      const unitCites = cite(unit.sourcePassageIds);
      const lessons = unit.lessons.filter(l => cite(l.sourcePassageIds).length || unitCites.length);
      dropped += unit.lessons.length - lessons.length;
      if (!unitCites.length && !lessons.length) { dropped += 1; continue; }
      const unitId = createId("lunit");
      await client.query(
        `INSERT INTO lrn_units(id,organization_id,scheme_id,seq,title,theme,week_from,week_to,competences,source_chunk_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [unitId, task.organizationId, scheme.id, u + 1, unit.title, unit.theme ?? null, unit.weekFrom ?? null, unit.weekTo ?? null, unit.competences ?? null, unitCites]);
      for (const lesson of lessons) {
        if (lessonSeq >= maxLessons) { dropped += 1; continue; }
        lessonSeq += 1;
        await client.query(
          `INSERT INTO lrn_lessons(id,organization_id,scheme_id,unit_id,seq,week,title,subtopic,objectives,source_chunk_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
          [createId("lles"), task.organizationId, scheme.id, unitId, lessonSeq, lesson.week ?? unit.weekFrom ?? null, lesson.title, lesson.subtopic ?? null,
            JSON.stringify(lesson.objectives), cite(lesson.sourcePassageIds).length ? cite(lesson.sourcePassageIds) : unitCites]);
      }
    }
    if (!lessonSeq) throw new Error("The outline had no lessons that trace back to the e-library passages.");
    await client.query(
      `UPDATE lrn_schemes SET status='writing',summary=$2,title=COALESCE(NULLIF($3,''),title),error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [scheme.id, reply.summary ?? null, reply.title ?? ""]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await queueNextLesson(runtime, task.organizationId, scheme.id, task.requestedBy);
  passages = [];
  return { units: reply.units.length, lessons: lessonSeq, droppedUncited: dropped, gaps: reply.gaps };
});

/** Lessons are written strictly one after another: each finished lesson queues the next pending one. */
export async function queueNextLesson(runtime: Runtime, organizationId: string, schemeId: string, requestedBy: string | null) {
  const next = await runtime.db.query<{ id: string; seq: number }>(
    `SELECT id,seq FROM lrn_lessons WHERE scheme_id=$1 AND status IN ('pending') ORDER BY seq LIMIT 1`, [schemeId]);
  if (!next.rows[0]) {
    await runtime.db.query(
      `UPDATE lrn_schemes SET status=CASE WHEN status IN ('writing','outlining') THEN 'review' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [schemeId]);
    return null;
  }
  await enqueueTask(runtime, organizationId, "lesson.write", next.rows[0].id, { priority: 50 + Math.min(next.rows[0].seq, 49), requestedBy });
  return next.rows[0].id;
}

const lessonReply = z.object({
  notes: z.string().max(30000),
  methods: z.string().max(3000).nullish(),
  materials: z.string().max(3000).nullish(),
  lifeSkills: z.string().max(2000).nullish(),
  assessment: z.string().max(4000).nullish(),
  sourcePassageIds: ids,
  activities: z.array(z.object({
    question: z.string().min(2).max(2000),
    answer: z.string().max(2000).nullish(),
    options: z.array(z.string().max(500)).max(8).nullish(),
    kind: z.string().max(40).nullish(),
    concept: z.string().max(200).nullish(),
    skill: z.string().max(200).nullish(),
    cognitiveLevel: z.string().max(20).nullish(),
    difficulty: z.number().int().min(1).max(5).nullish(),
    sourcePassageId: z.string().max(80),
    sourceQuote: z.string().max(1000),
  })).max(40).default([]),
  gaps: z.array(z.string().max(500)).max(20).default([]),
});

/** Step 3..n (AI): one lesson at a time — learner notes, methods, materials and source activities for the bank. */
registerTaskHandler("lesson.write", async (ctx: TaskContext) => {
  const { runtime, task, settings } = ctx;
  const lesson = await runtime.db.query<{
    id: string; schemeId: string; seq: number; title: string; subtopic: string | null; objectives: string[]; sourceChunkIds: string[]; status: string;
    unitTitle: string; theme: string | null;
  }>(
    `SELECT l.id,l.scheme_id AS "schemeId",l.seq,l.title,l.subtopic,l.objectives,l.source_chunk_ids AS "sourceChunkIds",l.status,u.title AS "unitTitle",u.theme
       FROM lrn_lessons l JOIN lrn_units u ON u.id=l.unit_id WHERE l.id=$1 AND l.organization_id=$2`, [task.subjectRef, task.organizationId]);
  const l = lesson.rows[0];
  if (!l) return { skipped: "lesson no longer exists" };
  const scheme = await loadScheme(runtime, task.organizationId, l.schemeId);
  if (l.status === "written" || l.status === "reviewed") { await queueNextLesson(runtime, task.organizationId, scheme.id, task.requestedBy); return { skipped: "already written" }; }
  await runtime.db.query(`UPDATE lrn_lessons SET status='writing',error=NULL WHERE id=$1`, [l.id]);

  const budget = Math.floor(settings.maxPromptChars * 0.8);
  const cited = await runtime.db.query<Passage>(
    `SELECT c.id,c.source_id AS "sourceId",s.title AS "sourceTitle",c.seq,c.content FROM lrn_source_chunks c JOIN lrn_sources s ON s.id=c.source_id
      WHERE c.id=ANY($1::text[]) AND c.organization_id=$2`, [l.sourceChunkIds, task.organizationId]);
  const sources = (await schemeSources(runtime, scheme.id)).map(s => s.id);
  const query = [l.unitTitle, l.theme, l.title, l.subtopic, ...(l.objectives ?? [])].filter(Boolean).join(" ");
  const passages: Passage[] = [];
  let used = 0;
  for (const p of [...cited.rows, ...await relevantPassages(runtime, task.organizationId, sources, query, budget, 10)]) {
    if (passages.some(x => x.id === p.id) || used + p.content.length > budget) continue;
    passages.push(p);
    used += p.content.length;
  }
  if (!passages.length) throw new Error("No e-library passages cover this lesson.");
  const byId = new Map(passages.map(p => [p.id, p]));

  const reply = lessonReply.parse(await ctx.ai({
    prompt: [
      `Task: write lesson ${l.seq} of the ${scheme.subjectName} scheme for ${scheme.className}, ${scheme.termName}.`,
      `Unit: ${l.unitTitle}${l.theme ? ` (theme: ${l.theme})` : ""}. Lesson: ${l.title}${l.subtopic ? ` — ${l.subtopic}` : ""}.`,
      l.objectives?.length ? `Objectives: ${l.objectives.join("; ")}` : "",
      "",
      "Write, using ONLY the passages below:",
      "- notes: clear learner notes in Markdown at the class level, restating what the passages say on this lesson (definitions, examples, diagrams described in words).",
      "- methods, materials, lifeSkills, assessment: as given or implied in the passages; null when the passages are silent.",
      "- activities: questions and exercises for learners copied from the passages (exercises, examples, past paper items).",
      "  For each one set sourcePassageId and sourceQuote = the question's exact words copied from that passage, so it can be verified.",
      "  Give answer only when the passage gives it or it is plain arithmetic; otherwise null. concept = the subtopic it tests, skill = what the learner does (e.g. 'identify', 'compute', 'explain').",
      "  kind is one of: " + QUESTION_KINDS.join(", ") + ". cognitiveLevel is one of: " + COGNITIVE_LEVELS.join(", ") + ".",
      "- sourcePassageIds: every passage id you used.",
      "",
      "Reply shape:",
      `{"notes":string,"methods":string|null,"materials":string|null,"lifeSkills":string|null,"assessment":string|null,"sourcePassageIds":[string],"activities":[{"question":string,"answer":string|null,"options":[string]|null,"kind":string,"concept":string,"skill":string,"cognitiveLevel":string,"difficulty":1-5,"sourcePassageId":string,"sourceQuote":string}],"gaps":[string]}`,
      "",
      "<passages>",
      formatPassages(passages),
      "</passages>",
    ].filter(line => line !== null).join("\n"),
  }));

  const usedIds = reply.sourcePassageIds.filter(id => byId.has(id));
  if (!usedIds.length) throw new Error("The lesson notes did not cite any of the supplied passages.");
  let added = 0, rejected = 0;
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE lrn_lessons SET notes_markdown=$2,methods=$3,materials=$4,life_skills=$5,assessment=$6,source_chunk_ids=$7,status='written',error=NULL,written_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [l.id, reply.notes, reply.methods ?? null, reply.materials ?? null, reply.lifeSkills ?? null, reply.assessment ?? null, usedIds]);
    for (const a of reply.activities) {
      const passage = byId.get(a.sourcePassageId);
      // Only questions whose wording is really in the cited passage go into the bank.
      if (!passage || !quoteAppearsIn(a.sourceQuote, passage.content)) { rejected += 1; continue; }
      const r = await addQuestion(client, {
        organizationId: task.organizationId, classId: scheme.classId, subjectId: scheme.subjectId, termId: scheme.termId, schemeId: scheme.id, lessonId: l.id,
        stem: a.question, answer: a.answer, options: a.options, kind: a.kind, concept: a.concept ?? l.subtopic ?? l.title, skill: a.skill,
        difficulty: a.difficulty, cognitiveLevel: a.cognitiveLevel, topic: l.unitTitle, subtopic: l.subtopic ?? l.title,
        origin: "elibrary", sourceChunkId: passage.id, sourceQuote: a.sourceQuote, verified: true,
      });
      if (r.created) added += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await queueNextLesson(runtime, task.organizationId, scheme.id, task.requestedBy);
  return { lesson: l.seq, passages: passages.length, questionsAdded: added, questionsRejected: rejected, gaps: reply.gaps };
});

onTaskFailed("scheme.source", async (runtime, task, message) => {
  await runtime.db.query(`UPDATE lrn_schemes SET status='failed',error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [task.subjectRef, message]);
});
onTaskFailed("scheme.outline", async (runtime, task, message) => {
  await runtime.db.query(`UPDATE lrn_schemes SET status='failed',error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [task.subjectRef, message]);
});
onTaskFailed("lesson.write", async (runtime, task, message) => {
  // One lesson failing must not stall the rest of the scheme.
  const row = await runtime.db.query<{ schemeId: string }>(
    `UPDATE lrn_lessons SET status='failed',error=$2 WHERE id=$1 RETURNING scheme_id AS "schemeId"`, [task.subjectRef, message]);
  if (row.rows[0]) await queueNextLesson(runtime, task.organizationId, row.rows[0].schemeId, task.requestedBy);
});

export async function getScheme(runtime: Runtime, organizationId: string, id: string) {
  const scheme = await runtime.db.query(
    `SELECT sc.id,sc.title,sc.status,sc.summary,sc.error,sc.weeks,sc.periods_per_week AS "periodsPerWeek",sc.library_filters AS library,
            sc.term_id AS "termId",sc.class_id AS "classId",sc.subject_id AS "subjectId",c.name AS "className",s.name AS "subjectName",t.name AS "termName",
            sc.published_at AS "publishedAt",sc.created_at AS "createdAt",sc.updated_at AS "updatedAt"
       FROM lrn_schemes sc JOIN school_classes c ON c.id=sc.class_id JOIN school_subjects s ON s.id=sc.subject_id JOIN school_terms t ON t.id=sc.term_id
      WHERE sc.id=$1 AND sc.organization_id=$2`, [id, organizationId]);
  if (!scheme.rows[0]) throw new AppError(404, "NOT_FOUND", "Scheme not found");
  const [units, lessons, sources, tasks] = await Promise.all([
    runtime.db.query(`SELECT id,seq,title,theme,week_from AS "weekFrom",week_to AS "weekTo",competences FROM lrn_units WHERE scheme_id=$1 ORDER BY seq`, [id]),
    runtime.db.query(
      `SELECT l.id,l.unit_id AS "unitId",l.seq,l.week,l.title,l.subtopic,l.objectives,l.status,l.error,l.written_at AS "writtenAt",
              (SELECT count(*)::int FROM lrn_questions q WHERE q.lesson_id=l.id) AS questions
         FROM lrn_lessons l WHERE l.scheme_id=$1 ORDER BY l.seq`, [id]),
    runtime.db.query(
      `SELECT s.id,s.title,s.resource_type AS type,ss.role,s.page_url AS "pageUrl",s.chunk_count AS passages,s.total_chars AS chars
         FROM lrn_scheme_sources ss JOIN lrn_sources s ON s.id=ss.source_id WHERE ss.scheme_id=$1 ORDER BY ss.role,s.title`, [id]),
    runtime.db.query(
      `SELECT t.kind,t.status,count(*)::int AS n FROM lrn_ai_tasks t
        WHERE t.organization_id=$2 AND (t.subject_ref=$1 OR t.subject_ref IN (SELECT id FROM lrn_lessons WHERE scheme_id=$1)) GROUP BY 1,2`, [id, organizationId]),
  ]);
  const counts = lessons.rows.reduce((acc: Record<string, number>, l: { status: string }) => ({ ...acc, [l.status]: (acc[l.status] ?? 0) + 1 }), {});
  return { ...scheme.rows[0], progress: { lessons: lessons.rows.length, ...counts }, units: units.rows, lessons: lessons.rows, sources: sources.rows, tasks: tasks.rows };
}

export async function getLesson(runtime: Runtime, organizationId: string, id: string) {
  const row = await runtime.db.query(
    `SELECT l.*,u.title AS unit_title FROM lrn_lessons l JOIN lrn_units u ON u.id=l.unit_id WHERE l.id=$1 AND l.organization_id=$2`, [id, organizationId]);
  if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Lesson not found");
  const l = row.rows[0] as Record<string, unknown> & { source_chunk_ids: string[] };
  const citations = await runtime.db.query(
    `SELECT c.id AS "passageId",s.title,s.page_url AS "pageUrl",c.seq+1 AS part FROM lrn_source_chunks c JOIN lrn_sources s ON s.id=c.source_id WHERE c.id=ANY($1::text[])`,
    [l.source_chunk_ids]);
  return {
    id: l.id, schemeId: l.scheme_id, unit: l.unit_title, seq: l.seq, week: l.week, title: l.title, subtopic: l.subtopic, objectives: l.objectives,
    notes: l.notes_markdown, methods: l.methods, materials: l.materials, lifeSkills: l.life_skills, assessment: l.assessment,
    status: l.status, error: l.error, writtenAt: l.written_at, citations: citations.rows,
  };
}

/** Re-runs generation: the outline (wiping unpublished lessons), or only the failed lessons. */
export async function regenerate(runtime: Runtime, organizationId: string, userId: string, schemeId: string, what: "outline" | "failed_lessons" | "sources") {
  const scheme = await loadScheme(runtime, organizationId, schemeId);
  if (scheme.status === "published") throw new AppError(409, "SCHEME_PUBLISHED", "Unpublish the scheme before regenerating it");
  if (what === "sources") {
    await runtime.db.query(`UPDATE lrn_schemes SET status='sourcing',error=NULL WHERE id=$1`, [schemeId]);
    await enqueueTask(runtime, organizationId, "scheme.source", schemeId, { priority: 10, requestedBy: userId });
  } else if (what === "outline") {
    await runtime.db.query(`UPDATE lrn_schemes SET status='outlining',error=NULL WHERE id=$1`, [schemeId]);
    await enqueueTask(runtime, organizationId, "scheme.outline", schemeId, { priority: 20, requestedBy: userId });
  } else {
    await runtime.db.query(`UPDATE lrn_lessons SET status='pending',error=NULL WHERE scheme_id=$1 AND status='failed'`, [schemeId]);
    await runtime.db.query(`UPDATE lrn_schemes SET status='writing',error=NULL WHERE id=$1`, [schemeId]);
    await queueNextLesson(runtime, organizationId, schemeId, userId);
  }
  return { id: schemeId, regenerating: what };
}

export async function setPublished(runtime: Runtime, organizationId: string, userId: string, schemeId: string, publish: boolean) {
  const scheme = await loadScheme(runtime, organizationId, schemeId);
  if (publish && !["review", "published"].includes(scheme.status)) {
    const pending = await runtime.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lrn_lessons WHERE scheme_id=$1 AND status IN ('pending','writing')`, [schemeId]);
    if (pending.rows[0]!.n) throw new AppError(409, "SCHEME_NOT_READY", `${pending.rows[0]!.n} lessons are still being written`);
  }
  await runtime.db.query(
    `UPDATE lrn_schemes SET status=$2,published_at=CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,published_by=CASE WHEN $3 THEN $4 ELSE NULL END,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1`, [schemeId, publish ? "published" : "review", publish, userId]);
  return { id: schemeId, status: publish ? "published" : "review" };
}
