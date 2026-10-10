import { z } from "zod";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";
import { createId } from "../core-identity/security.js";
import { ulibtech } from "../school-management/ulibtech.js";
import { enqueueTask, onTaskFailed, registerTaskHandler, type TaskContext, parseLenient } from "./engine.js";
import { addQuestion, COGNITIVE_LEVELS, QUESTION_KINDS } from "./questions.js";
import { quoteAppearsIn } from "./signature.js";
import { sanitizeSvg } from "./svg.js";
import { codedFigureRow, labelFigure, requestFigure } from "./figures.js";
import { codedSpecSchema } from "./figures-coded.js";
import { classesInTitle, formatPassages, ingestResource, openingPassages, parseTerm, relevantPassages, type Passage, type Scope } from "./sources.js";

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
  // School rule: a term scheme is 10 teaching weeks, one period a day Monday to Friday. Other values are ignored.
  weeks: z.number().int().min(1).max(20).optional(),
  periodsPerWeek: z.number().int().min(1).max(20).optional(),
  /** Write lesson notes/plans only up to this week for now (the outline always covers the whole term). */
  writeUntilWeek: z.number().int().min(1).max(20).optional(),
  /** Override the e-library class/subject/term mapping, or name the exact resources to use. */
  library: z.object({
    classSlug: z.string().max(40).optional(), subjectSlug: z.string().max(80).optional(), termSlug: z.string().max(40).optional(),
    resourceSlugs: z.array(z.string().min(1).max(240)).max(12).optional(),
  }).default({}),
});

/** A term scheme: 10 teaching weeks, one lesson (one period) a day, Monday to Friday = 50 lessons. */
export const TERM_WEEKS = 10, DAYS_PER_WEEK = 5;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
export const dayName = (period: number | null) => DAY_NAMES[((period ?? 1) - 1) % 5] ?? "Monday";

export async function createScheme(runtime: Runtime, organizationId: string, userId: string, input: z.infer<typeof createSchemeSchema>) {
  const refs = await runtime.db.query<{ className: string; subjectName: string; termName: string; academicYearId: string | null }>(
    `SELECT c.name AS "className",s.name AS "subjectName",t.name AS "termName",t.academic_year_id AS "academicYearId"
       FROM school_classes c, school_subjects s, school_terms t
      WHERE c.id=$1 AND c.organization_id=$4 AND s.id=$2 AND s.organization_id=$4 AND t.id=$3 AND t.organization_id=$4`,
    [input.classId, input.subjectId, input.termId, organizationId]);
  const ref = refs.rows[0];
  if (!ref) throw new AppError(404, "NOT_FOUND", "Class, subject or term not found in this school");
  // One scheme per class, subject and term. Archive or delete the old one to make a new one.
  const existing = await runtime.db.query<{ id: string; status: string }>(
    `SELECT id,status FROM lrn_schemes WHERE organization_id=$1 AND term_id=$2 AND class_id=$3 AND subject_id=$4 AND status NOT IN ('archived','failed') LIMIT 1`,
    [organizationId, input.termId, input.classId, input.subjectId]);
  if (existing.rows[0]) throw new AppError(409, "SCHEME_EXISTS", `${ref.subjectName} for ${ref.className}, ${ref.termName} already has a scheme`, { schemeId: existing.rows[0].id });
  const termNumber = /(\d)/.exec(ref.termName)?.[1] ?? Object.entries(WORDS).find(([w]) => ref.termName.toLowerCase().includes(w))?.[1];
  const library = {
    classSlug: input.library.classSlug ?? libraryClassSlug(ref.className),
    subjectSlug: input.library.subjectSlug ?? await librarySubjectSlug(runtime, ref.subjectName).catch(() => null),
    termSlug: input.library.termSlug ?? (termNumber ? `term-${termNumber}` : null),
    resourceSlugs: input.library.resourceSlugs ?? [],
  };
  const id = createId("lsch");
  await runtime.db.query(
    `INSERT INTO lrn_schemes(id,organization_id,academic_year_id,term_id,class_id,subject_id,title,library_filters,weeks,periods_per_week,status,created_by,write_until_week)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'sourcing',$11,$12)`,
    [id, organizationId, ref.academicYearId, input.termId, input.classId, input.subjectId,
      input.title || `${ref.subjectName} · ${ref.className} · ${ref.termName}`, JSON.stringify(library), TERM_WEEKS, DAYS_PER_WEEK, userId, input.writeUntilWeek ?? 0]);
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

const ROLE_BY_TYPE: Record<string, string> = { "schemes-of-work": "scheme", "lesson-plans": "lesson_plans", notes: "notes", "past-papers": "past_papers", curriculum: "curriculum" };
const WANT: Array<[string, number]> = [["curriculum", 1], ["schemes-of-work", 2], ["lesson-plans", 1], ["notes", 3], ["past-papers", 1]];

type CatalogItem = { slug: string; title: string; status: string; type: string | null; class: string | null; term: string | null; chars: number; sha256: string | null };

/** The scheme's class and term as a passage scope (e.g. p5 + term 1). */
export function schemeScope(library: { classSlug: string | null; termSlug: string | null }): Scope {
  const m = /^(p|s)(\d)$/.exec(library.classSlug ?? "");
  const n = /^(baby|middle|top)-class$/.exec(library.classSlug ?? "");
  return {
    cls: m ? { level: m[1] as "p" | "s", no: Number(m[2]) } : n ? { level: "n", no: { baby: 1, middle: 2, top: 3 }[n[1] as "baby"] } : null,
    term: /^term-(\d)$/.exec(library.termSlug ?? "")?.[1] ? Number(/^term-(\d)$/.exec(library.termSlug!)![1]) : null,
  };
}

/**
 * Picks the best material of each type: published before drafts, this term (or all-term books) first, the most
 * complete text first, never two copies of the same book, and books that cover several classes when they include ours.
 */
async function pickFromCatalog(library: ReturnType<typeof ulibtech>, classSlug: string, subjectSlug: string, termSlug: string | null, scope: Scope) {
  const picked: Array<{ slug: string; role: string; title: string }> = [];
  const seen: CatalogItem[] = [];
  const same = (a: CatalogItem, b: CatalogItem) =>
    (a.sha256 && a.sha256 === b.sha256) || Math.abs(a.chars - b.chars) <= Math.max(200, a.chars * 0.005) ||
    a.title.toLowerCase().replace(/[^a-z0-9]/g, "") === b.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [type, count] of WANT) {
    const own = await library.catalog({ class: classSlug, subject: subjectSlug, type, limit: 40 });
    const wide = (await library.catalog({ subject: subjectSlug, type, limit: 100 }))
      .filter(i => i.class !== classSlug && classesInTitle(i.title).some(c => scope.cls && c.level === scope.cls.level && c.no === scope.cls.no));
    const termNo = scope.term;
    const termScore = (i: CatalogItem) => {
      const t = parseTerm(i.title);
      if (/all\s+(?:year|terms)|t1\s*-?\s*t3|terms?\s*(?:1|i|one)\s*(?:-|–|to|&)\s*(?:3|iii|three)|i\s*,?\s*ii\s*,?\s*(?:&|and)?\s*iii/i.test(i.title)) return 1;
      if (termNo && t === termNo) return 2;
      if (termNo && t && t !== termNo) return -2;
      if (termSlug && i.term === termSlug) return 1;
      return 0;
    };
    const ranked = [...own, ...wide].sort((a, b) =>
      Number(b.status === "published") - Number(a.status === "published") || termScore(b) - termScore(a) || b.chars - a.chars);
    let n = 0;
    for (const item of ranked) {
      if (n >= count) break;
      // Catalogue class tags are sometimes wrong: a book whose title names other classes only is not ours.
      const named = classesInTitle(item.title);
      if (named.length && scope.cls && !named.some(c => c.level === scope.cls!.level && c.no === scope.cls!.no)) continue;
      if (termScore(item) < 0 || seen.some(x => same(x, item))) continue;
      seen.push(item);
      picked.push({ slug: item.slug, role: /curricul/i.test(item.title) ? "curriculum" : ROLE_BY_TYPE[type] ?? "reference", title: item.title });
      n += 1;
    }
  }
  return picked;
}

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
    if (library.textEnabled) {
      picked.push(...await pickFromCatalog(library, scheme.library.classSlug, scheme.library.subjectSlug, scheme.library.termSlug, schemeScope(scheme.library)));
    } else {
      for (const [type, count] of WANT) {
        const items = (await library.search({ class: scheme.library.classSlug, subject: scheme.library.subjectSlug, type, pageSize: count })).items;
        for (const item of items) if (!picked.some(p => p.slug === item.slug)) picked.push({ slug: item.slug, role: ROLE_BY_TYPE[type] ?? "reference" });
      }
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
      ORDER BY CASE ss.role WHEN 'curriculum' THEN 0 WHEN 'scheme' THEN 1 WHEN 'lesson_plans' THEN 2 WHEN 'notes' THEN 3 WHEN 'reference' THEN 4 ELSE 5 END,s.title`, [schemeId]);
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
      periods: z.number().int().min(1).max(10).nullish(),
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
  const primary = sources.filter(s => ["curriculum", "scheme", "lesson_plans", "reference"].includes(s.role)).map(s => s.id);
  const budget = Math.floor(settings.maxPromptChars * 0.85);
  const scope = schemeScope(scheme.library);
  // Only the part of each book for this class and term (a P4–P6 book contributes its P5 Term 1 section).
  let passages: Passage[] = await openingPassages(runtime, task.organizationId, primary.length ? primary : sources.map(s => s.id), budget, scope);
  if (!passages.length) throw new Error("The scheme has no source passages to work from.");
  const allowed = new Set(passages.map(p => p.id));
  const reply = parseLenient(outlineReply, await ctx.ai({
    prompt: [
      `Task: draft the OUTLINE of a scheme of work for ${scheme.subjectName}, ${scheme.className}, ${scheme.termName}.`,
      `The term has ${scheme.weeks} teaching weeks and the subject is taught ONE period a day, Monday to Friday: ${scheme.periodsPerWeek} lessons a week, exactly ${scheme.weeks * scheme.periodsPerWeek} lessons in total.`,
      `Every lesson is one period. Give exactly ${scheme.weeks * scheme.periodsPerWeek} lessons in teaching order (lesson 1 = week 1 Monday, lesson 6 = week 2 Monday, ...); split big subtopics over several lessons and use revision or assessment lessons where the material runs short.`,
      "You are composing the SCHOOL'S OWN scheme. The passages below (Ugandan curricula, schemes of work, lesson plans, notes and past papers from the school e-library) are reference material:",
      "combine them — follow the curriculum's order and coverage where present, use the reference schemes for week-by-week pacing, and the notes and past papers for what each subtopic must cover. Do not copy one reference scheme blindly.",
      `Use this term's part of the material (${scheme.termName}) when the passages cover several terms.`,
      "Do NOT write lesson content yet. Each unit and lesson must cite the passage ids it comes from in sourcePassageIds.",
      "",
      "Reply shape:",
      `{"title":string,"summary":string,"units":[{"title":string,"theme":string|null,"weekFrom":int|null,"weekTo":int|null,"competences":string|null,"sourcePassageIds":[string],"lessons":[{"title":string,"subtopic":string|null,"week":int|null,"periods":int,"objectives":[string],"sourcePassageIds":[string]}]}],"gaps":[string]}`,
      "",
      "<passages>",
      formatPassages(passages),
      "</passages>",
    ].join("\n"),
  }));
  // Keep only what is traceable to the passages we supplied.
  const cite = (list: string[]) => list.filter(id => allowed.has(id));
  const maxPeriods = scheme.weeks * scheme.periodsPerWeek;
  let lessonSeq = 0, dropped = 0, periodsUsed = 0;
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
        const periods = 1; // one period a day
        if (periodsUsed + periods > maxPeriods) { dropped += 1; continue; }
        lessonSeq += 1;
        periodsUsed += periods;
        await client.query(
          `INSERT INTO lrn_lessons(id,organization_id,scheme_id,unit_id,seq,week,periods,title,subtopic,objectives,source_chunk_ids,period) VALUES($1,$2,$3,$4,$5,$6,$11,$7,$8,$9::jsonb,$10,$12)`,
          [createId("lles"), task.organizationId, scheme.id, unitId, lessonSeq, Math.floor((lessonSeq - 1) / scheme.periodsPerWeek) + 1, lesson.title, lesson.subtopic ?? null,
            JSON.stringify(lesson.objectives), cite(lesson.sourcePassageIds).length ? cite(lesson.sourcePassageIds) : unitCites, periods, ((lessonSeq - 1) % scheme.periodsPerWeek) + 1]);
      }
    }
    if (!lessonSeq) throw new Error("The outline had no lessons that trace back to the e-library passages.");
    await client.query(`UPDATE lrn_units u SET week_from=x.f,week_to=x.t FROM (SELECT unit_id,min(week) AS f,max(week) AS t FROM lrn_lessons WHERE scheme_id=$1 GROUP BY unit_id) x WHERE x.unit_id=u.id`, [scheme.id]);
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
  return { units: reply.units.length, lessons: lessonSeq, periods: periodsUsed, droppedUncitedOrOverTerm: dropped, gaps: reply.gaps };
});

/** Lessons are written strictly one after another: each finished lesson queues the next pending one. */
export async function queueNextLesson(runtime: Runtime, organizationId: string, schemeId: string, requestedBy: string | null) {
  const next = await runtime.db.query<{ id: string; seq: number }>(
    `SELECT l.id,l.seq FROM lrn_lessons l JOIN lrn_schemes sc ON sc.id=l.scheme_id
      WHERE l.scheme_id=$1 AND l.status='pending' AND (l.notes_requested OR sc.write_until_week IS NULL OR COALESCE(l.week,1) <= sc.write_until_week)
      ORDER BY l.seq LIMIT 1`, [schemeId]);
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
  lessonPlan: z.object({
    competences: z.array(z.string().max(500)).max(8).default([]),
    languageCompetence: z.string().max(500).nullish(),
    objectives: z.array(z.string().max(500)).max(8).default([]),
    priorKnowledge: z.string().max(1000).nullish(),
    methods: z.array(z.string().max(200)).max(10).default([]),
    materials: z.array(z.string().max(200)).max(15).default([]),
    references: z.array(z.string().max(300)).max(8).default([]),
    steps: z.array(z.object({
      stage: z.string().max(80),
      minutes: z.number().int().min(1).max(120).nullish(),
      teacherActivity: z.string().max(2000),
      learnerActivity: z.string().max(2000),
    })).min(1).max(10),
    assessment: z.string().max(2000).nullish(),
    homework: z.string().max(1000).nullish(),
    lifeSkills: z.array(z.string().max(120)).max(8).default([]),
  }).nullish(),
  diagrams: z.array(z.object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/),
    title: z.string().min(1).max(200),
    caption: z.string().max(500).nullish(),
    /** "illustration": a realistic drawing from the figure library (generated once, reused); "coded": exact code-drawn figure; "svg": simple schematic. */
    method: z.enum(["illustration", "coded", "svg"]).default("svg"),
    concept: z.string().max(300).nullish(),
    parts: z.array(z.string().min(1).max(80)).max(20).default([]),
    coded: z.unknown().optional(),
    svg: z.string().max(60000).nullish(),
    sourcePassageId: z.string().max(80).nullish(),
  })).max(4).default([]),
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
    id: string; schemeId: string; seq: number; periods: number; title: string; subtopic: string | null; objectives: string[]; sourceChunkIds: string[]; status: string;
    unitTitle: string; theme: string | null;
  }>(
    `SELECT l.id,l.scheme_id AS "schemeId",l.seq,l.periods,l.title,l.subtopic,l.objectives,l.source_chunk_ids AS "sourceChunkIds",l.status,u.title AS "unitTitle",u.theme
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
  for (const p of [...cited.rows, ...await relevantPassages(runtime, task.organizationId, sources, query, budget, 10, schemeScope(scheme.library))]) {
    if (passages.some(x => x.id === p.id) || used + p.content.length > budget) continue;
    passages.push(p);
    used += p.content.length;
  }
  if (!passages.length) throw new Error("No e-library passages cover this lesson.");
  const byId = new Map(passages.map(p => [p.id, p]));

  const periodLength = await runtime.db.query<{ minutes: number }>(
    `SELECT period_minutes AS minutes FROM lrn_timetable_settings WHERE organization_id=$1`, [task.organizationId]).catch(() => ({ rows: [] as Array<{ minutes: number }> }));
  const minutes = (periodLength.rows[0]?.minutes ?? 40) * (l.periods ?? 1);
  const reply = parseLenient(lessonReply, await ctx.ai({
    prompt: [
      `Task: write lesson ${l.seq} of the ${scheme.subjectName} scheme for ${scheme.className}, ${scheme.termName}. It takes ${l.periods ?? 1} period(s), ${minutes} minutes in total.`,
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
      "- diagrams: up to 3 teaching pictures of things the passages describe that learners must SEE. Skip them when nothing in the lesson is visual.",
      "  NEVER make a table, list or text box into a diagram; tables belong in the notes as Markdown tables. Choose a method per picture:",
      "  * method \"illustration\" for real things: animals, plants, body parts and organs, tools, apparatus, objects, scenes (e.g. the external parts of a domestic fowl, a beehive, a flower).",
      "    Give concept = a precise description of what to draw (e.g. 'side view of a domestic hen, full body') and parts = the exact part names from the passages to label. No svg. Ledgerly draws it once and reuses it.",
      "    For a picture comparing two things, name each part with its owner so both get labelled, e.g. 'comb (cock)', 'comb (hen)'.",
      "  * method \"coded\" for exact maths pictures, with coded = one of:",
      "    {\"type\":\"shape\",\"shape\":\"circle|square|rectangle|triangle|right-triangle|equilateral-triangle|isosceles-triangle|parallelogram|rhombus|trapezium|kite|pentagon|hexagon|octagon\"}",
      "    {\"type\":\"fraction\",\"shape\":\"circle|bar\",\"numerator\":3,\"denominator\":4}   {\"type\":\"number-line\",\"from\":0,\"to\":10,\"step\":1,\"marks\":[3,7]}",
      "    {\"type\":\"map\",\"region\":\"uganda\",\"layers\":[\"lakes\",\"rivers\",\"mountains\",\"towns\",\"neighbours\",\"regions\",\"equator\"],\"highlight\":[\"Northern\"]} for any map of Uganda (pick the layers needed; parts = the lakes, rivers, mountains, towns, neighbours or regions to label, e.g. 'Lake Kyoga', 'River Victoria Nile', 'Mount Elgon', 'Kenya', 'Northern Region'),",
      "    {\"type\":\"clock\",\"hour\":3,\"minute\":30}   {\"type\":\"bar-chart\",\"title\":\"...\",\"yLabel\":\"...\",\"bars\":[{\"label\":\"Mon\",\"value\":4}]} (only with data given in the passages)",
      "  All pictures are printed in BLACK: black outlines on white, mostly outline, simple grey or hatched shading only where needed, never colour.",
      "  * method \"svg\" for simple schematics only (cycles, food chains, flow of a process): a self-contained SVG, viewBox=\"0 0 640 420\", white background, black outlined shapes (fills white or light grey #e6e6e6 only),",
      "    labels font-size 16-18 joined by leader lines, arrows via <marker>, a title at the top, nothing outside the viewBox. No scripts, images, links, CSS or external fonts.",
      "  Label only parts the passages name. key is a short slug; put [[diagram:key]] on its own line in the notes where it belongs; sourcePassageId is the passage it depicts.",
      "- sourcePassageIds: every passage id you used.",
      "",
      "Reply shape:",
      `{"notes":string,"methods":string|null,"materials":string|null,"lifeSkills":string|null,"assessment":string|null,"sourcePassageIds":[string],` +
      `"diagrams":[{"key":string,"title":string,"caption":string|null,"method":"illustration"|"coded"|"svg","concept":string|null,"parts":[string],"coded":object|null,"svg":string|null,"sourcePassageId":string|null}],"activities":[{"question":string,"answer":string|null,"options":[string]|null,"kind":string,"concept":string,"skill":string,"cognitiveLevel":string,"difficulty":1-5,"sourcePassageId":string,"sourceQuote":string}],"gaps":[string]}`,
      "",
      "<passages>",
      formatPassages(passages),
      "</passages>",
    ].filter(line => line !== null).join("\n"),
  }));

  const usedIds = reply.sourcePassageIds.filter(id => byId.has(id));
  if (!usedIds.length) throw new Error("The lesson notes did not cite any of the supplied passages.");
  let added = 0, rejected = 0, diagrams = 0, diagramsRejected = 0, reusedFigures = 0, queuedFigures = 0;
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE lrn_lessons SET notes_markdown=$2,methods=$3,materials=$4,life_skills=$5,assessment=$6,source_chunk_ids=$7,lesson_plan=COALESCE($8::jsonb,lesson_plan),status='written',error=NULL,written_at=CURRENT_TIMESTAMP WHERE id=$1`,
      [l.id, reply.notes, reply.methods ?? null, reply.materials ?? null, reply.lifeSkills ?? null, reply.assessment ?? null, usedIds, reply.lessonPlan ? JSON.stringify(reply.lessonPlan) : null]);
    await client.query("DELETE FROM lrn_lesson_assets WHERE lesson_id=$1", [l.id]);
    for (const d of reply.diagrams) {
      const source = d.sourcePassageId && byId.has(d.sourcePassageId) ? d.sourcePassageId : null;
      let svg: string | null = null, figureId: string | null = null, labelingId: string | null = null;
      if (d.method === "coded") {
        const spec = codedSpecSchema.safeParse(d.coded);
        if (!spec.success) { diagramsRejected += 1; continue; }
        const fig = await codedFigureRow(runtime, task.organizationId, spec.data);
        figureId = fig.id;
        if (d.parts.length) labelingId = (await labelFigure(runtime, fig.id, { mode: "names", parts: d.parts }).catch(() => null))?.id ?? null;
        if (!labelingId) svg = fig.svg;
      } else if (d.method === "illustration" && d.concept) {
        const got = await requestFigure(runtime, task.organizationId, task.requestedBy, {
          concept: d.concept, title: d.title, parts: d.parts, subject: scheme.subjectName, level: scheme.className.replace(/\s+\d{4}$/, ""),
        });
        if (got.figure) {
          figureId = got.figure.id;
          if (got.figure.status === "ready") labelingId = (await labelFigure(runtime, got.figure.id, { mode: "names", parts: d.parts }).catch(() => null))?.id ?? null;
          if (got.reused) reusedFigures += 1; else queuedFigures += 1;
        } else if (d.svg) svg = sanitizeSvg(d.svg);
        if (!figureId && !svg) { diagramsRejected += 1; continue; }
      } else {
        svg = d.svg ? sanitizeSvg(d.svg) : null;
        if (!svg) { diagramsRejected += 1; continue; }
      }
      await client.query(
        `INSERT INTO lrn_lesson_assets(id,organization_id,lesson_id,kind,asset_key,title,caption,svg,source_chunk_id,figure_id,labeling_id,parts)
         VALUES($1,$2,$3,'diagram',$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(lesson_id,asset_key) DO NOTHING`,
        [createId("lasset"), task.organizationId, l.id, d.key, d.title, d.caption ?? null, svg, source, figureId, labelingId, d.parts]);
      diagrams += 1;
    }
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
  return { lesson: l.seq, passages: passages.length, lessonPlan: Boolean(reply.lessonPlan), diagrams, diagramsRejected, reusedFigures, queuedFigures, questionsAdded: added, questionsRejected: rejected, gaps: reply.gaps };
});

onTaskFailed("scheme.source", async (runtime, task, message) => {
  await runtime.db.query(`UPDATE lrn_schemes SET status='failed',error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [task.subjectRef, message]);
});
onTaskFailed("scheme.outline", async (runtime, task, message) => {
  await runtime.db.query(`UPDATE lrn_schemes SET status='failed',error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [task.subjectRef, message]);
});
/** The DOS asks for one week at a time: first its notes, then its lesson plans (plans are written from the notes). */
export async function requestWeek(runtime: Runtime, organizationId: string, userId: string, schemeId: string, week: number, what: "notes" | "plans") {
  const sc = await runtime.db.query<{ status: string }>(`SELECT status FROM lrn_schemes WHERE id=$1 AND organization_id=$2`, [schemeId, organizationId]);
  if (!sc.rows[0]) throw new AppError(404, "NOT_FOUND", "Scheme not found");
  if (["draft", "sourcing", "outlining"].includes(sc.rows[0].status)) throw new AppError(409, "OUTLINE_NOT_READY", "The scheme outline is still being written");
  if (what === "notes") {
    const r = await runtime.db.query(`UPDATE lrn_lessons SET notes_requested=true,status=CASE WHEN status='failed' THEN 'pending' ELSE status END,error=NULL
      WHERE scheme_id=$1 AND week=$2 AND status IN ('pending','failed') RETURNING id`, [schemeId, week]);
    if (r.rowCount) await runtime.db.query(`UPDATE lrn_schemes SET status=CASE WHEN status IN ('review','published') THEN status ELSE 'writing' END,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [schemeId]);
    await queueNextLesson(runtime, organizationId, schemeId, userId);
    return { week, what, queued: r.rowCount ?? 0 };
  }
  const missing = await runtime.db.query(`SELECT 1 FROM lrn_lessons WHERE scheme_id=$1 AND week=$2 AND status NOT IN ('written','reviewed')`, [schemeId, week]);
  if (missing.rowCount) throw new AppError(409, "NOTES_FIRST", `Write the notes for week ${week} first; the plans are made from them`);
  const r = await runtime.db.query(`UPDATE lrn_lessons SET plan_status='requested',plan_error=NULL WHERE scheme_id=$1 AND week=$2 AND plan_status IN ('none','failed') RETURNING id`, [schemeId, week]);
  await queueNextPlan(runtime, organizationId, schemeId, userId);
  return { week, what, queued: r.rowCount ?? 0 };
}

export async function queueNextPlan(runtime: Runtime, organizationId: string, schemeId: string, requestedBy: string | null) {
  const next = await runtime.db.query<{ id: string; seq: number }>(
    `SELECT id,seq FROM lrn_lessons WHERE scheme_id=$1 AND plan_status='requested' AND status IN ('written','reviewed') ORDER BY seq LIMIT 1`, [schemeId]);
  if (!next.rows[0]) return null;
  await enqueueTask(runtime, organizationId, "lesson.plan", next.rows[0].id, { priority: 60 + Math.min(next.rows[0].seq, 39), requestedBy });
  return next.rows[0].id;
}

const planReply = z.object({ lessonPlan: lessonReply.shape.lessonPlan.unwrap().unwrap() });

/** The lesson plan for one lesson, written from its notes (no new passages needed, so it is a small step). */
registerTaskHandler("lesson.plan", async (ctx: TaskContext) => {
  const { runtime, task } = ctx;
  const row = await runtime.db.query<{ id: string; schemeId: string; seq: number; week: number | null; period: number | null; title: string; subtopic: string | null;
    objectives: string[]; notes: string | null; methods: string | null; materials: string | null; unit: string; planStatus: string }>(
    `SELECT l.id,l.scheme_id AS "schemeId",l.seq,l.week,l.period,l.title,l.subtopic,l.objectives,l.notes_markdown AS notes,l.methods,l.materials,u.title AS unit,l.plan_status AS "planStatus"
       FROM lrn_lessons l JOIN lrn_units u ON u.id=l.unit_id WHERE l.id=$1 AND l.organization_id=$2`, [task.subjectRef, task.organizationId]);
  const l = row.rows[0];
  if (!l) return { skipped: "lesson no longer exists" };
  const scheme = await loadScheme(runtime, task.organizationId, l.schemeId);
  if (l.planStatus === "written" || !l.notes) { await queueNextPlan(runtime, task.organizationId, scheme.id, task.requestedBy); return { skipped: l.notes ? "already planned" : "no notes" }; }
  await runtime.db.query(`UPDATE lrn_lessons SET plan_status='writing' WHERE id=$1`, [l.id]);
  const sources = await runtime.db.query<{ title: string }>(
    `SELECT DISTINCT s.title FROM lrn_source_chunks c JOIN lrn_sources s ON s.id=c.source_id
      WHERE c.id IN (SELECT jsonb_array_elements_text(to_jsonb(source_chunk_ids)) FROM lrn_lessons WHERE id=$1)`, [l.id]).catch(() => ({ rows: [] as Array<{ title: string }> }));
  const periodLength = await runtime.db.query<{ minutes: number }>(
    `SELECT period_minutes AS minutes FROM lrn_timetable_settings WHERE organization_id=$1`, [task.organizationId]).catch(() => ({ rows: [] as Array<{ minutes: number }> }));
  const minutes = periodLength.rows[0]?.minutes ?? 40;
  const reply = parseLenient(planReply, await ctx.ai({
    prompt: [
      `Task: write the LESSON PLAN for lesson ${l.seq} of the ${scheme.subjectName} scheme for ${scheme.className}, ${scheme.termName}: week ${l.week ?? 1}, ${dayName(l.period)}, one period of ${minutes} minutes.`,
      `Unit: ${l.unit}. Lesson: ${l.title}${l.subtopic ? ` — ${l.subtopic}` : ""}.`,
      l.objectives?.length ? `Objectives: ${l.objectives.join("; ")}` : "",
      "Use the Ugandan lesson plan format: competences (subject and language competence), objectives, prior knowledge, methods, materials, references,",
      `and steps (Introduction, Lesson development, Conclusion; split development into parts when useful) with minutes adding up to ${minutes}, and both the teacher's and the learners' activity, plus assessment, homework and life skills.`,
      "The content (facts, examples, questions) must come from the lesson notes below; the structure and timing are yours. References are the source titles listed.",
      "",
      "Reply shape:",
      `{"lessonPlan":{"competences":[string],"languageCompetence":string|null,"objectives":[string],"priorKnowledge":string|null,"methods":[string],"materials":[string],"references":[string],"steps":[{"stage":string,"minutes":int,"teacherActivity":string,"learnerActivity":string}],"assessment":string|null,"homework":string|null,"lifeSkills":[string]}}`,
      "",
      `Sources: ${sources.rows.map(s => s.title).join("; ") || "the school e-library"}`,
      l.methods ? `Methods suggested by the sources: ${l.methods}` : "",
      l.materials ? `Materials suggested by the sources: ${l.materials}` : "",
      "<notes>", l.notes.replace(/\[\[diagram:[^\]]+\]\]/g, "[diagram]"), "</notes>",
    ].filter(Boolean).join("\n"),
  }));
  await runtime.db.query(`UPDATE lrn_lessons SET lesson_plan=$2::jsonb,plan_status='written',plan_error=NULL WHERE id=$1`, [l.id, JSON.stringify(reply.lessonPlan)]);
  await queueNextPlan(runtime, task.organizationId, scheme.id, task.requestedBy);
  return { steps: reply.lessonPlan.steps.length };
});

onTaskFailed("lesson.plan", async (runtime, task, message) => {
  const row = await runtime.db.query<{ schemeId: string }>(
    `UPDATE lrn_lessons SET plan_status='failed',plan_error=$2 WHERE id=$1 RETURNING scheme_id AS "schemeId"`, [task.subjectRef, message]);
  if (row.rows[0]) await queueNextPlan(runtime, task.organizationId, row.rows[0].schemeId, task.requestedBy);
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
      `SELECT l.id,l.unit_id AS "unitId",l.seq,l.week,l.period AS day,l.periods,l.title,l.subtopic,l.objectives,l.status,l.error,l.written_at AS "writtenAt",
              l.notes_requested AS "notesRequested",l.plan_status AS "planStatus",l.plan_error AS "planError",
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
  const assets = await runtime.db.query(
    `SELECT id,kind,asset_key AS key,title,caption FROM lrn_lesson_assets WHERE lesson_id=$1 ORDER BY created_at`, [id]);
  return {
    id: l.id, schemeId: l.scheme_id, unit: l.unit_title, seq: l.seq, week: l.week, periods: l.periods, title: l.title, subtopic: l.subtopic, objectives: l.objectives,
    notes: l.notes_markdown, lessonPlan: l.lesson_plan, methods: l.methods, materials: l.materials, lifeSkills: l.life_skills, assessment: l.assessment,
    diagrams: assets.rows.map((a: { id: string }) => ({ ...a, url: `/api/v1/learn/lessons/${id}/assets/${a.id}.svg` })),
    status: l.status, error: l.error, writtenAt: l.written_at, citations: citations.rows, day: l.period, dayName: dayName(l.period as number | null), planStatus: l.plan_status,
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
    const pending = await runtime.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM lrn_lessons l JOIN lrn_schemes sc ON sc.id=l.scheme_id
        WHERE l.scheme_id=$1 AND (l.status='writing' OR (l.status='pending' AND (sc.write_until_week IS NULL OR COALESCE(l.week,1) <= sc.write_until_week)))`, [schemeId]);
    if (pending.rows[0]!.n) throw new AppError(409, "SCHEME_NOT_READY", `${pending.rows[0]!.n} lessons are still being written`);
  }
  await runtime.db.query(
    `UPDATE lrn_schemes SET status=$2,published_at=CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,published_by=CASE WHEN $3 THEN $4 ELSE NULL END,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1`, [schemeId, publish ? "published" : "review", publish, userId]);
  return { id: schemeId, status: publish ? "published" : "review" };
}

/** Writes more of an outlined scheme: lessons up to a later week (or the whole term with null). */
export async function writeUntil(runtime: Runtime, organizationId: string, userId: string, schemeId: string, week: number | null) {
  const row = await runtime.db.query(`UPDATE lrn_schemes SET write_until_week=$3,status=CASE WHEN status IN ('review','writing') THEN 'writing' ELSE status END,updated_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND organization_id=$2 RETURNING id`, [schemeId, organizationId, week]);
  if (!row.rowCount) throw new AppError(404, "NOT_FOUND", "Scheme not found");
  return { id: schemeId, writeUntilWeek: week, next: await queueNextLesson(runtime, organizationId, schemeId, userId) };
}
