import type { ToolContext } from "./tools";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { Env } from "../../../src/types";
import { resolveLightReferences } from "./light-reference-resolver";
import { approveAndExecuteAction } from "./executor";

const MAX_ROWS = 300;
const WEEKDAYS: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };
export const IMPORT_ENTITY_FOR_TOOL: Record<string, string> = { import_timetable_entries: "timetable_entry", import_scheme_items: "scheme_item", import_subject_assignments: "subject_assignment", import_teacher_assignments: "teacher_assignment", import_lesson_plans: "lesson_plan" };

type ImportField = {
  name: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "date" | "time" | "weekday";
  default?: unknown;
};

type ImportEntity = {
  key: string;
  label: string;
  containerField?: { name: string; label: string; notes: string };
  path: (row: Record<string, unknown>, container: string) => string;
  omitFromBody?: string[];
  fields: ImportField[];
  example: Record<string, unknown>;
  prompt: string;
};

const scopeFor = (_path: string) => "school:write";

export const IMPORT_ENTITIES: Record<string, ImportEntity> = {
  timetable_entry: {
    key: "timetable_entry",
    label: "Timetable entries",
    containerField: { name: "timetableId", label: "Timetable Id", notes: "The timetable to add these periods to. Get it from the export kit or /list timetables." },
    path: (_row, timetableId) => `/api/v1/academics/timetables/${timetableId}/entries`,
    fields: [
      { name: "classId", required: true, type: "string" },
      { name: "streamId", type: "string" },
      { name: "subjectId", required: true, type: "string" },
      { name: "teacherStaffId", required: true, type: "string" },
      { name: "roomId", type: "string" },
      { name: "weekday", required: true, type: "weekday" },
      { name: "startsAt", required: true, type: "time" },
      { name: "endsAt", required: true, type: "time" },
      { name: "notes", type: "string" },
    ],
    example: { classId: "P6 Blue", subjectId: "Mathematics", teacherStaffId: "STF-70512358", weekday: "Monday", startsAt: "08:00", endsAt: "08:40" },
    prompt: "Produce a JSON array of weekly timetable periods for this timetable. Each item needs: classId (class name or code), streamId (optional), subjectId (subject name or code), teacherStaffId (teacher name or staff number), roomId (optional), weekday (Monday-Sunday), startsAt and endsAt (24h HH:MM). Only use classes/subjects/teachers that appear in referenceData below. Avoid double-booking the same teacher, class or room in an overlapping time on the same weekday.",
  },
  scheme_item: {
    key: "scheme_item",
    label: "Scheme of work items",
    containerField: { name: "schemeId", label: "Scheme Id", notes: "The scheme of work to add these items to. Get it from the export kit or /list schemes." },
    path: (_row, schemeId) => `/api/v1/academics/schemes/${schemeId}/items`,
    fields: [
      { name: "weekNumber", required: true, type: "number" },
      { name: "sequence", type: "number", default: 1 },
      { name: "topic", required: true, type: "string" },
      { name: "subtopic", type: "string" },
      { name: "learningOutcomes", type: "string" },
      { name: "teachingMethods", type: "string" },
      { name: "learningResources", type: "string" },
      { name: "assessmentStrategy", type: "string" },
      { name: "plannedPeriods", type: "number", default: 1 },
    ],
    example: { weekNumber: 1, sequence: 1, topic: "Introduction to fractions", plannedPeriods: 3 },
    prompt: "Produce a JSON array of scheme-of-work items (a week-by-week syllabus coverage plan) for this scheme. Each item needs: weekNumber, sequence (order within the week), topic, and optionally subtopic, learningOutcomes, teachingMethods, learningResources, assessmentStrategy, plannedPeriods. Base topics on the actual subject/class curriculum, in a logical teaching order across the term.",
  },
  subject_assignment: {
    key: "subject_assignment",
    label: "Subject assignments (class level to subject)",
    path: () => `/api/v1/school/setup/classSubjects`,
    fields: [
      { name: "classLevelId", required: true, type: "string" },
      { name: "subjectId", required: true, type: "string" },
      { name: "academicYearId", type: "string" },
      { name: "compulsory", type: "boolean", default: true },
      { name: "periodsPerWeek", type: "number" },
      { name: "teacherUserId", type: "string" },
      { name: "active", type: "boolean", default: true },
    ],
    example: { classLevelId: "P6", subjectId: "Mathematics", periodsPerWeek: 5, compulsory: true },
    prompt: "Produce a JSON array assigning subjects to class levels. Each item needs: classLevelId (class level name/code), subjectId (subject name/code), and optionally academicYearId, compulsory (true/false), periodsPerWeek, teacherUserId. Only use class levels and subjects from referenceData below; cover every subject each class level should study.",
  },
  teacher_assignment: {
    key: "teacher_assignment",
    label: "Teacher teaching assignments",
    path: (row) => `/api/v1/school/staff-management/staff/${row.staffId}/teaching-assignments`,
    omitFromBody: ["staffId"],
    fields: [
      { name: "staffId", required: true, type: "string" },
      { name: "academicYearId", type: "string" },
      { name: "termId", type: "string" },
      { name: "classId", required: true, type: "string" },
      { name: "streamId", type: "string" },
      { name: "subjectId", required: true, type: "string" },
      { name: "periodsPerWeek", type: "number" },
      { name: "active", type: "boolean", default: true },
    ],
    example: { staffId: "STF-70512358", classId: "P6 Blue", subjectId: "Mathematics", periodsPerWeek: 5 },
    prompt: "Produce a JSON array assigning teachers to teach a subject in a class. Each item needs: staffId (teacher name or staff number), classId (class name/code), subjectId (subject name/code), and optionally streamId, academicYearId, termId, periodsPerWeek. Only use teachers, classes and subjects from referenceData below; do not assign a teacher to a subject they are not qualified/listed for unless asked.",
  },
  lesson_plan: {
    key: "lesson_plan",
    label: "Lesson plans",
    path: () => `/api/v1/academics/lesson-plans`,
    fields: [
      { name: "academicYearId", required: true, type: "string" },
      { name: "termId", required: true, type: "string" },
      { name: "classId", required: true, type: "string" },
      { name: "streamId", type: "string" },
      { name: "subjectId", required: true, type: "string" },
      { name: "teacherStaffId", type: "string" },
      { name: "lessonDate", required: true, type: "date" },
      { name: "startsAt", type: "time" },
      { name: "endsAt", type: "time" },
      { name: "topic", required: true, type: "string" },
      { name: "subtopic", type: "string" },
      { name: "competency", type: "string" },
      { name: "learningOutcomes", required: true, type: "string" },
      { name: "priorKnowledge", type: "string" },
      { name: "teachingMethods", type: "string" },
      { name: "learningResources", type: "string" },
      { name: "introduction", type: "string" },
      { name: "lessonDevelopment", type: "string" },
      { name: "assessment", type: "string" },
      { name: "conclusion", type: "string" },
      { name: "differentiation", type: "string" },
      { name: "homework", type: "string" },
    ],
    example: { classId: "P6 Blue", subjectId: "Mathematics", teacherStaffId: "STF-70512358", lessonDate: "2026-09-22", topic: "Adding fractions with unlike denominators", learningOutcomes: "Learners can add two fractions with unlike denominators." },
    prompt: "Produce a JSON array of individual lesson plans. Each item needs: academicYearId, termId, classId, subjectId, lessonDate (YYYY-MM-DD), topic, learningOutcomes, and optionally streamId, teacherStaffId, startsAt/endsAt (HH:MM), subtopic, competency, priorKnowledge, teachingMethods, learningResources, introduction, lessonDevelopment, assessment, conclusion, differentiation, homework. Base lessons on the scheme of work topics in referenceData when available.",
  },
};

function stripCodeFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json|csv)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line), row: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) row[h] = cells[i] ?? ""; });
    return row;
  });
}

export function parseImportPayload(data: string): Record<string, unknown>[] {
  const text = stripCodeFence(String(data || ""));
  if (!text) throw new AppError(422, "VALIDATION_ERROR", "Paste JSON or CSV data to import.");
  if (text.startsWith("[") || text.startsWith("{")) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new AppError(422, "VALIDATION_ERROR", "That doesn't look like valid JSON. Check for a trailing comma or unclosed bracket."); }
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw new AppError(422, "VALIDATION_ERROR", "Each JSON item must be an object of field:value pairs.");
    return rows as Record<string, unknown>[];
  }
  const rows = parseCsv(text);
  if (!rows.length) throw new AppError(422, "VALIDATION_ERROR", "No data rows found. Include a header row followed by one row per record.");
  return rows;
}

function coerceField(field: ImportField, raw: unknown): { value: unknown; issue?: string } {
  if (raw === undefined || raw === null || raw === "") return { value: field.default };
  if (field.type === "number") { const n = Number(raw); return Number.isFinite(n) ? { value: n } : { value: raw, issue: `${field.name} must be a number` }; }
  if (field.type === "boolean") { if (typeof raw === "boolean") return { value: raw }; const s = String(raw).trim().toLowerCase(); if (["true", "yes", "1"].includes(s)) return { value: true }; if (["false", "no", "0"].includes(s)) return { value: false }; return { value: raw, issue: `${field.name} must be true/false` }; }
  if (field.type === "date") { const s = String(raw).trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { value: s } : { value: raw, issue: `${field.name} must be YYYY-MM-DD` }; }
  if (field.type === "time") { const s = String(raw).trim(); return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? { value: s } : { value: raw, issue: `${field.name} must be 24h HH:MM` }; }
  if (field.type === "weekday") {
    if (typeof raw === "number" && raw >= 1 && raw <= 7) return { value: raw };
    const n = WEEKDAYS[String(raw).trim().toLowerCase()];
    return n ? { value: n } : { value: raw, issue: `${field.name} must be a weekday name or 1-7 (Monday=1)` };
  }
  return { value: String(raw) };
}

function looksLikeId(value: unknown) { return typeof value === "string" && /^[a-z]{2,18}_[A-Za-z0-9-]{4,}$/i.test(value); }

// Term codes/names (e.g. "T1") repeat across academic years, so resolving termId
// in isolation is ambiguous whenever a school has more than one year set up.
// When a row also carries academicYearId, resolve the year first and scope the
// term lookup to it instead of leaving this to the generic, unscoped resolver.
async function resolveScopedTermId(db: D1Database, organizationId: string, academicYearRaw: unknown, termRaw: unknown): Promise<{ termId?: string; issue?: string } | null> {
  const termText = String(termRaw ?? "").trim();
  if (!termText || looksLikeId(termText)) return null;
  const yearResolved = await resolveLightReferences(db, organizationId, { academicYearId: academicYearRaw });
  const academicYearId = (yearResolved.value as any)?.academicYearId;
  if (!looksLikeId(academicYearId)) return null;
  const rows = await db.prepare(`SELECT id FROM school_terms WHERE organization_id=? AND academic_year_id=? AND (lower(code)=lower(?) OR lower(name)=lower(?)) LIMIT 3`).bind(organizationId, academicYearId, termText, termText).all<{ id: string }>();
  const ids = [...new Set(rows.results.map((r) => r.id))];
  if (ids.length === 1) return { termId: ids[0] };
  if (ids.length > 1) return { issue: `termId "${termText}" matches multiple terms within that academic year.` };
  return { issue: `Could not resolve termId "${termText}" within the selected academic year.` };
}

async function prepareRows(db: D1Database, organizationId: string, entity: ImportEntity, rawRows: Record<string, unknown>[]) {
  if (rawRows.length > MAX_ROWS) throw new AppError(422, "VALIDATION_ERROR", `Import one batch at a time (max ${MAX_ROWS} rows; got ${rawRows.length}).`);
  const hasScopedTerm = entity.fields.some((f) => f.name === "termId") && entity.fields.some((f) => f.name === "academicYearId");
  const prepared: { row: Record<string, unknown>; issues: string[] }[] = [];
  for (const raw of rawRows) {
    const typed: Record<string, unknown> = {}, issues: string[] = [];
    for (const field of entity.fields) {
      const found = Object.keys(raw).find((k) => k.toLowerCase() === field.name.toLowerCase());
      const { value, issue } = coerceField(field, found ? raw[found] : undefined);
      if (issue) issues.push(issue);
      if (field.required && (value === undefined || value === null || value === "")) issues.push(`${field.name} is required`);
      if (value !== undefined) typed[field.name] = value;
    }
    if (hasScopedTerm && typed.termId !== undefined) {
      const scoped = await resolveScopedTermId(db, organizationId, typed.academicYearId, typed.termId);
      if (scoped?.termId) typed.termId = scoped.termId;
      else if (scoped?.issue) { issues.push(scoped.issue); delete typed.termId; }
    }
    const resolved = await resolveLightReferences(db, organizationId, typed);
    issues.push(...resolved.issues);
    prepared.push({ row: resolved.value as Record<string, unknown>, issues });
  }
  return prepared;
}

export async function executeAcademicsImport(ctx: ToolContext & { env: Env }, entityKey: string, args: Record<string, unknown>) {
  const entity = IMPORT_ENTITIES[entityKey];
  if (!entity) throw new AppError(404, "COMMAND_NOT_FOUND", "Unknown import type.");
  if (!ctx.env.AGENT_SYSTEM_GATEWAY) throw new AppError(503, "GATEWAY_UNAVAILABLE", "Ledgerly command gateway is unavailable.");
  let container = "";
  if (entity.containerField) {
    container = String(args[entity.containerField.name] || "").trim();
    if (!container) throw new AppError(422, "VALIDATION_ERROR", `${entity.containerField.label} is required.`);
  }
  const rawRows = parseImportPayload(String(args.data || ""));
  const prepared = await prepareRows(ctx.db, ctx.principal.organizationId, entity, rawRows);
  const invalid = prepared.map((p, i) => ({ index: i + 1, issues: p.issues })).filter((p) => p.issues.length);
  if (invalid.length) return { validated: false, totalRows: prepared.length, invalidRows: invalid, message: `${invalid.length} of ${prepared.length} row(s) have problems. Fix them and resubmit — nothing was written.` };

  const results: { index: number; status: "created" | "failed"; id?: string; error?: string }[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const row = prepared[i]!.row, path = entity.path(row, container), body = { ...row };
    for (const omit of entity.omitFromBody || []) delete body[omit];
    const payload = { agentKey: ctx.agent.key, method: "POST", path, body };
    const key = `conversation:${ctx.conversationId}:import:${entityKey}:${i}:${createId("h")}`, id = createId("aea");
    await ctx.db.prepare(`INSERT INTO ae_actions(id,organization_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status) VALUES(?,?,?,?,?,?,?,?,?,'suggested')`).bind(id, ctx.principal.organizationId, ctx.agent.key, "system.api.request", `Import ${entity.label} row ${i + 1}`.slice(0, 240), `Bulk import row ${i + 1} of ${prepared.length}, submitted directly via the chat composer.`, scopeFor(path), JSON.stringify(payload), key).run();
    try {
      const { result } = await approveAndExecuteAction(ctx.env, ctx.principal, id);
      results.push({ index: i + 1, status: "created", id: String((result as any)?.response?.data?.id || (result as any)?.entityId || "") });
    } catch (error) {
      const detail = (error as any)?.details?.error?.message;
      results.push({ index: i + 1, status: "failed", error: typeof detail === "string" ? detail : error instanceof Error ? error.message : String(error) });
    }
  }
  const created = results.filter((r) => r.status === "created").length;
  return { validated: true, totalRows: prepared.length, created, failed: prepared.length - created, results };
}

async function listRows(db: D1Database, organizationId: string, table: string, columns: string, extra = "", limit = 500) {
  return (await db.prepare(`SELECT ${columns} FROM ${table} WHERE organization_id=?${extra} ORDER BY 2 LIMIT ${limit}`).bind(organizationId).all<any>()).results;
}

async function gatherReferenceData(db: D1Database, organizationId: string) {
  const [classLevels, classes, streams, subjects, staff, academicYears, terms, timetables, schemes] = await Promise.all([
    listRows(db, organizationId, "school_class_levels", "id,name,code", " AND active=true"),
    listRows(db, organizationId, "school_classes", "id,name,code", " AND active=true"),
    listRows(db, organizationId, "school_streams", "id,name,code", " AND active=true"),
    listRows(db, organizationId, "school_subjects", "id,name,code", " AND active=true"),
    listRows(db, organizationId, "school_staff_profiles", "id,staff_number,first_name,last_name,is_teacher", " AND deleted_at IS NULL"),
    listRows(db, organizationId, "school_academic_years", "id,name,code"),
    listRows(db, organizationId, "school_terms", "id,name,code"),
    listRows(db, organizationId, "school_academic_timetables", "id,name,academic_year_id"),
    listRows(db, organizationId, "school_schemes_of_work", "id,title,class_id"),
  ]);
  return {
    classLevels: classLevels.map((r: any) => ({ id: r.id, name: r.name, code: r.code })),
    classes: classes.map((r: any) => ({ id: r.id, name: r.name, code: r.code })),
    streams: streams.map((r: any) => ({ id: r.id, name: r.name, code: r.code })),
    subjects: subjects.map((r: any) => ({ id: r.id, name: r.name, code: r.code })),
    teachers: staff.map((r: any) => ({ id: r.id, staffNumber: r.staff_number, name: `${r.first_name} ${r.last_name}`.trim(), isTeacher: Boolean(r.is_teacher) })),
    academicYears: academicYears.map((r: any) => ({ id: r.id, name: r.name, code: r.code })),
    terms: terms.map((r: any) => ({ id: r.id, name: r.name, code: r.code })),
    timetables: timetables.map((r: any) => ({ id: r.id, name: r.name, academicYearId: r.academic_year_id })),
    schemesOfWork: schemes.map((r: any) => ({ id: r.id, title: r.title, classId: r.class_id })),
  };
}

export async function exportAcademicsImportKit(db: D1Database, organizationId: string) {
  const referenceData = await gatherReferenceData(db, organizationId);
  const entities = Object.fromEntries(Object.values(IMPORT_ENTITIES).map((e) => [e.key, {
    importCommand: `/import ${e.label.toLowerCase()}`,
    requiresContainer: e.containerField ? { field: e.containerField.name, notes: e.containerField.notes } : undefined,
    fields: e.fields.map((f) => ({ name: f.name, required: Boolean(f.required), type: f.type || "string" })),
    example: e.example,
    prompt: e.prompt,
  }])) as Record<string, unknown>;
  return {
    referenceData,
    entities,
    instructions: "Give referenceData and the relevant entity's prompt+fields+example to your AI of choice, ask it to return ONLY a JSON array matching the fields (use names/codes from referenceData, not made-up IDs), then paste that array into the matching /import command's Data field (or upload it as CSV with the same column names). Names are resolved to the real Ledgerly record automatically; unresolvable names are reported before anything is written.",
  };
}

function listLine(label: string, rows: { name?: string; title?: string; code?: string; staffNumber?: string; id: string }[], max = 60) {
  if (!rows.length) return `${label}: (none yet — create some first, or omit this field)`;
  const shown = rows.slice(0, max).map((r) => { const name = r.name || r.title || "?", tag = r.code || r.staffNumber; return tag ? `${name} (${tag})` : name; });
  const more = rows.length > max ? `, …and ${rows.length - max} more` : "";
  return `${label}: ${shown.join(", ")}${more}`;
}

export async function buildImportPromptText(db: D1Database, organizationId: string, entityKey: string) {
  const entity = IMPORT_ENTITIES[entityKey];
  if (!entity) throw new AppError(404, "COMMAND_NOT_FOUND", "Unknown import type.");
  const ref = await gatherReferenceData(db, organizationId);
  const fieldLines = entity.fields.map((f) => `- ${f.name}: ${f.type || "string"}${f.required ? " (required)" : ""}${f.default !== undefined ? ` (default ${JSON.stringify(f.default)})` : ""}`).join("\n");
  const containerLine = entity.containerField ? `\nCONTAINER: this import also needs a "${entity.containerField.name}" (${entity.containerField.notes}) — pick one from the list below and paste it into that field in Ledgerly separately from the data you generate here.\n` : "";
  const dataLines = [
    listLine("Classes", ref.classes),
    listLine("Class levels", ref.classLevels),
    listLine("Streams", ref.streams),
    listLine("Subjects", ref.subjects),
    listLine("Teachers", ref.teachers.map((t) => ({ name: t.name, staffNumber: t.staffNumber, id: t.id }))),
    listLine("Academic years", ref.academicYears),
    listLine("Terms", ref.terms),
  ];
  if (entity.containerField?.name === "timetableId") dataLines.push(listLine("Timetables (id in parentheses)", ref.timetables.map((t) => ({ name: t.name, code: t.id, id: t.id }))));
  if (entity.containerField?.name === "schemeId") dataLines.push(listLine("Schemes of work (id in parentheses)", ref.schemesOfWork.map((s) => ({ name: s.title, code: s.id, id: s.id }))));
  return [
    `You are helping generate data to import into Ledgerly (a school management system) as "${entity.label}".`,
    "",
    `TASK: ${entity.prompt}`,
    containerLine.trim(),
    "FIELDS (name: type, required?):",
    fieldLines,
    "",
    "EXAMPLE ROW:",
    JSON.stringify(entity.example, null, 2),
    "",
    "AVAILABLE LEDGERLY DATA — use these exact names/codes; never invent an ID or a name that isn't listed:",
    ...dataLines,
    "",
    `Return ONLY a JSON array of objects matching the fields above (no explanation, no markdown fences). Produce as many rows as make sense for the request; each row must use names from the data above.`,
  ].filter(Boolean).join("\n");
}
