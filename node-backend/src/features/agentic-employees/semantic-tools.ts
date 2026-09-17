import type { Env } from "./shared.js";
import type { ToolContext } from "./tools-v14.js";
import { resolveGuardianFamily } from "./family-resolver.js";
import { cumulativeAcademicSection, cumulativeAttendanceSection, cumulativeFinanceSection } from "./family-sections.js";

export const SEMANTIC_TOOL_NAMES = [
  "semantic_capabilities",
  "resolve_entity",
  "get_related_entities",
  "query_metrics",
  "plan_timetable",
] as const;
export type SemanticToolName = typeof SEMANTIC_TOOL_NAMES[number];

type SemanticContext = ToolContext & { env?: Env };
type Row = Record<string, any>;

type MetricDomain = "identity" | "academics" | "attendance" | "finance" | "staff" | "timetable";
const DOMAIN_ACCESS: Record<string, readonly MetricDomain[]> = {
  secretary: ["identity"],
  dos: ["identity", "academics", "attendance", "staff", "timetable"],
  bursar: ["identity", "finance"],
  headteacher: ["identity", "academics", "attendance", "finance", "staff", "timetable"],
  hr: ["identity", "staff"],
  librarian: ["identity"],
};

const TOOL_SPECS: Record<SemanticToolName, any> = {
  semantic_capabilities: {
    type: "function", name: "semantic_capabilities", strict: false,
    description: "Discover the high-level Ledgerly entities, relationships and verified metric domains available to this AI employee. Use this instead of browsing hundreds of low-level routes when the user asks an unusual cross-module question.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  resolve_entity: {
    type: "function", name: "resolve_entity", strict: false,
    description: "Resolve a human-friendly name/code such as 'Mukisa Abraham', 'Mr Muwonge', 'P6', 'Mathematics' or 'Term 3' to tenant-scoped Ledgerly records. Never guess an ID; ambiguous matches are returned explicitly.",
    parameters: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["student", "guardian", "staff", "class", "stream", "subject", "academic_year", "term", "department", "timetable"] },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      }, required: ["entityType", "query"], additionalProperties: false,
    },
  },
  get_related_entities: {
    type: "function", name: "get_related_entities", strict: false,
    description: "Traverse recorded Ledgerly relationships without inferring them. Examples: guardian→children, student→guardians, class→students, staff→teaching assignments.",
    parameters: {
      type: "object",
      properties: {
        sourceType: { type: "string", enum: ["guardian", "student", "class", "staff"] },
        sourceId: { type: "string" },
        relation: { type: "string", enum: ["children", "guardians", "students", "teaching_assignments"] },
      }, required: ["sourceType", "sourceId", "relation"], additionalProperties: false,
    },
  },
  query_metrics: {
    type: "function", name: "query_metrics", strict: false,
    description: "Return verified Ledgerly evidence for flexible analysis. This is the primary tool for unusual reports and comparisons. It can combine a learner/family's academic, attendance and finance evidence, or staff teaching assignments, without exposing unrestricted SQL.",
    parameters: {
      type: "object",
      properties: {
        entityType: { type: "string", enum: ["student", "guardian", "staff"] },
        entityId: { type: "string" },
        query: { type: "string" },
        gender: { type: "string", description: "Optional learner gender filter when entityType=guardian, e.g. male/female. Use only when the user's wording requires it." },
        metrics: { type: "array", items: { type: "string", enum: ["profile", "academics", "attendance", "finance", "teaching_assignments"] }, minItems: 1, maxItems: 5 },
      }, required: ["entityType", "metrics"], additionalProperties: false,
    },
  },
  plan_timetable: {
    type: "function", name: "plan_timetable", strict: false,
    description: "Build a deterministic, UNSAVED timetable draft from Ledgerly teacher/class/subject assignments. If explicit timetable slots/rules do not exist, it bootstraps draft slots from supplied or safe school-day defaults, labels every assumption, respects hard teacher/class collisions and recorded teacher unavailability, and returns unscheduled lessons for review. It never publishes or writes the timetable.",
    parameters: {
      type: "object",
      properties: {
        academicYearId: { type: "string" }, termId: { type: "string" },
        schoolStart: { type: "string", description: "HH:MM, default 08:00" },
        schoolEnd: { type: "string", description: "HH:MM, default 16:00" },
        periodMinutes: { type: "integer", minimum: 20, maximum: 120 },
        weekdays: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, minItems: 1, maxItems: 7 },
        breaks: { type: "array", items: { type: "object", properties: { start: { type: "string" }, end: { type: "string" }, label: { type: "string" } }, required: ["start", "end"], additionalProperties: false } },
      }, additionalProperties: false,
    },
  },
};

function hasDomain(ctx: SemanticContext, domain: MetricDomain) {
  return (DOMAIN_ACCESS[ctx.agent.key] || []).includes(domain);
}
function requireDomain(ctx: SemanticContext, domain: MetricDomain) {
  if (!hasDomain(ctx, domain)) throw new Error(`${ctx.agent.title} is not allowed to query the ${domain} semantic domain`);
}
function enabled(agent: any, name: SemanticToolName, requested?: string[] | null) {
  if (!agent.tools.includes(name)) return false;
  if (!requested) return true;
  // Semantic tools are a compatibility layer. If an older employee configuration requested
  // only legacy tools, keep the semantic layer available rather than silently disabling it.
  return requested.includes(name) || !requested.some((x: string) => SEMANTIC_TOOL_NAMES.includes(x as SemanticToolName));
}
export function semanticOpenAiTools(agent: any, requested?: string[] | null) {
  return SEMANTIC_TOOL_NAMES.filter(name => enabled(agent, name, requested)).map(name => TOOL_SPECS[name]);
}
export function isSemanticTool(name: string): name is SemanticToolName {
  return SEMANTIC_TOOL_NAMES.includes(name as SemanticToolName);
}

function normalizePersonQuery(value: string) {
  return value.trim().replace(/^(mr|mrs|ms|miss|madam|teacher|tr|dr)\.?\s+/i, "").replace(/\s+/g, " ");
}
async function rows(db: D1Database, sql: string, ...values: unknown[]): Promise<Row[]> {
  const result = await db.prepare(sql).bind(...values).all<Row>();
  return (result.results || []) as Row[];
}
async function first(db: D1Database, sql: string, ...values: unknown[]): Promise<Row | null> {
  return await db.prepare(sql).bind(...values).first<Row>() || null;
}
function resultFor(entityType: string, query: string, matches: Row[]) {
  return {
    entityType, query, status: matches.length === 0 ? "not_found" : matches.length === 1 ? "resolved" : "ambiguous",
    resolved: matches.length === 1 ? matches[0] : null,
    matches,
    rule: matches.length > 1 ? "Do not guess. Ask the user to disambiguate or use another recorded identifier." : undefined,
  };
}

async function resolveEntity(ctx: SemanticContext, entityType: string, rawQuery: string, rawLimit?: unknown) {
  requireDomain(ctx, "identity");
  const org = ctx.principal.organizationId;
  const limit = Math.max(1, Math.min(20, Number(rawLimit) || 10));
  const query = normalizePersonQuery(String(rawQuery || ""));
  if (!query) throw new Error("query is required");
  const like = `%${query.toLowerCase()}%`;
  let found: Row[] = [];
  if (entityType === "student") found = await rows(ctx.db, `SELECT s.id,s.admission_number AS "admissionNumber",s.student_number AS "studentNumber",s.first_name AS "firstName",s.middle_name AS "middleName",s.last_name AS "lastName",s.gender,s.status,c.name AS "className",st.name AS "streamName" FROM school_students s LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id WHERE s.organization_id=? AND s.deleted_at IS NULL AND (LOWER(CONCAT_WS(' ',s.first_name,s.middle_name,s.last_name)) LIKE ? OR LOWER(s.admission_number)=LOWER(?) OR LOWER(s.student_number)=LOWER(?)) ORDER BY s.last_name,s.first_name LIMIT ?`, org, like, query, query, limit);
  else if (entityType === "guardian") found = await rows(ctx.db, `SELECT g.id,g.first_name AS "firstName",g.middle_name AS "middleName",g.last_name AS "lastName",g.phone_primary AS "phonePrimary",g.email,g.relationship_default AS "relationshipDefault",g.active FROM school_guardians g WHERE g.organization_id=? AND (LOWER(CONCAT_WS(' ',g.first_name,g.middle_name,g.last_name)) LIKE ? OR LOWER(COALESCE(g.phone_primary,''))=LOWER(?) OR LOWER(COALESCE(g.email,''))=LOWER(?)) ORDER BY g.last_name,g.first_name LIMIT ?`, org, like, query, query, limit);
  else if (entityType === "staff") found = await rows(ctx.db, `SELECT s.id,s.staff_number AS "staffNumber",s.first_name AS "firstName",s.middle_name AS "middleName",s.last_name AS "lastName",s.preferred_name AS "preferredName",s.is_teacher AS "isTeacher",s.employment_status AS "employmentStatus",d.name AS "departmentName",p.name AS "positionName" FROM school_staff_profiles s LEFT JOIN school_departments d ON d.id=s.department_id AND d.organization_id=s.organization_id LEFT JOIN school_staff_positions p ON p.id=s.position_id AND p.organization_id=s.organization_id WHERE s.organization_id=? AND s.deleted_at IS NULL AND (LOWER(CONCAT_WS(' ',s.first_name,s.middle_name,s.last_name)) LIKE ? OR LOWER(s.staff_number)=LOWER(?) OR LOWER(COALESCE(s.preferred_name,'')) LIKE ?) ORDER BY s.last_name,s.first_name LIMIT ?`, org, like, query, like, limit);
  else if (entityType === "class") found = await rows(ctx.db, `SELECT c.id,c.code,c.name,c.active,y.name AS "academicYear" FROM school_classes c LEFT JOIN school_academic_years y ON y.id=c.academic_year_id AND y.organization_id=c.organization_id WHERE c.organization_id=? AND (LOWER(c.name) LIKE ? OR LOWER(c.code)=LOWER(?)) ORDER BY c.active DESC,c.name LIMIT ?`, org, like, query, limit);
  else if (entityType === "stream") found = await rows(ctx.db, `SELECT s.id,s.code,s.name,s.class_id AS "classId",c.name AS "className",s.active FROM school_streams s JOIN school_classes c ON c.id=s.class_id AND c.organization_id=s.organization_id WHERE s.organization_id=? AND (LOWER(s.name) LIKE ? OR LOWER(s.code)=LOWER(?) OR LOWER(CONCAT(c.name,' ',s.name)) LIKE ?) ORDER BY s.active DESC,c.name,s.name LIMIT ?`, org, like, query, like, limit);
  else if (entityType === "subject") found = await rows(ctx.db, `SELECT id,code,name,short_name AS "shortName",subject_type AS "subjectType",pass_mark AS "passMark",max_mark AS "maxMark",active FROM school_subjects WHERE organization_id=? AND (LOWER(name) LIKE ? OR LOWER(code)=LOWER(?) OR LOWER(COALESCE(short_name,''))=LOWER(?)) ORDER BY active DESC,name LIMIT ?`, org, like, query, query, limit);
  else if (entityType === "academic_year") found = await rows(ctx.db, `SELECT id,code,name,starts_on AS "startsOn",ends_on AS "endsOn",status,is_current AS "isCurrent" FROM school_academic_years WHERE organization_id=? AND (LOWER(name) LIKE ? OR LOWER(code)=LOWER(?)) ORDER BY is_current DESC,starts_on DESC LIMIT ?`, org, like, query, limit);
  else if (entityType === "term") found = await rows(ctx.db, `SELECT t.id,t.code,t.name,t.sequence_no AS "sequenceNo",t.starts_on AS "startsOn",t.ends_on AS "endsOn",t.status,t.is_current AS "isCurrent",y.name AS "academicYear" FROM school_terms t JOIN school_academic_years y ON y.id=t.academic_year_id AND y.organization_id=t.organization_id WHERE t.organization_id=? AND (LOWER(t.name) LIKE ? OR LOWER(t.code)=LOWER(?)) ORDER BY t.is_current DESC,t.starts_on DESC LIMIT ?`, org, like, query, limit);
  else if (entityType === "department") found = await rows(ctx.db, `SELECT id,code,name,active FROM school_departments WHERE organization_id=? AND (LOWER(name) LIKE ? OR LOWER(code)=LOWER(?)) ORDER BY active DESC,name LIMIT ?`, org, like, query, limit);
  else if (entityType === "timetable") found = await rows(ctx.db, `SELECT t.id,t.name,t.status,t.academic_year_id AS "academicYearId",t.term_id AS "termId",y.name AS "academicYear",tm.name AS "term" FROM school_academic_timetables t JOIN school_academic_years y ON y.id=t.academic_year_id AND y.organization_id=t.organization_id JOIN school_terms tm ON tm.id=t.term_id AND tm.organization_id=t.organization_id WHERE t.organization_id=? AND LOWER(t.name) LIKE ? ORDER BY t.created_at DESC LIMIT ?`, org, like, limit);
  else throw new Error(`Unsupported entity type: ${entityType}`);
  return resultFor(entityType, query, found);
}

async function relatedEntities(ctx: SemanticContext, sourceType: string, sourceId: string, relation: string) {
  requireDomain(ctx, "identity");
  const org = ctx.principal.organizationId;
  if (sourceType === "guardian" && relation === "children") return { sourceType, sourceId, relation, records: await rows(ctx.db, `SELECT s.id,s.admission_number AS "admissionNumber",s.first_name AS "firstName",s.middle_name AS "middleName",s.last_name AS "lastName",s.gender,s.status,sg.relationship,sg.primary_guardian AS "primaryGuardian",sg.financial_responsibility AS "financialResponsibility",c.name AS "className",st.name AS "streamName" FROM school_student_guardians sg JOIN school_students s ON s.id=sg.student_id AND s.organization_id=sg.organization_id LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id WHERE sg.organization_id=? AND sg.guardian_id=? AND s.deleted_at IS NULL ORDER BY s.last_name,s.first_name`, org, sourceId) };
  if (sourceType === "student" && relation === "guardians") return { sourceType, sourceId, relation, records: await rows(ctx.db, `SELECT g.id,g.first_name AS "firstName",g.middle_name AS "middleName",g.last_name AS "lastName",g.phone_primary AS "phonePrimary",g.email,sg.relationship,sg.primary_guardian AS "primaryGuardian",sg.financial_responsibility AS "financialResponsibility" FROM school_student_guardians sg JOIN school_guardians g ON g.id=sg.guardian_id AND g.organization_id=sg.organization_id WHERE sg.organization_id=? AND sg.student_id=? ORDER BY sg.primary_guardian DESC,g.last_name,g.first_name`, org, sourceId) };
  if (sourceType === "class" && relation === "students") return { sourceType, sourceId, relation, records: await rows(ctx.db, `SELECT id,admission_number AS "admissionNumber",first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",gender,status,current_stream_id AS "streamId" FROM school_students WHERE organization_id=? AND current_class_id=? AND deleted_at IS NULL ORDER BY last_name,first_name`, org, sourceId) };
  if (sourceType === "staff" && relation === "teaching_assignments") {
    requireDomain(ctx, "staff");
    return { sourceType, sourceId, relation, records: await teachingAssignments(ctx, sourceId) };
  }
  throw new Error(`Unsupported relationship: ${sourceType} → ${relation}`);
}

async function teachingAssignments(ctx: SemanticContext, staffId: string) {
  const org = ctx.principal.organizationId;
  return rows(ctx.db, `SELECT a.id,a.staff_id AS "staffId",a.academic_year_id AS "academicYearId",a.term_id AS "termId",a.class_id AS "classId",c.name AS "className",a.stream_id AS "streamId",st.name AS "streamName",a.subject_id AS "subjectId",su.name AS "subjectName",a.periods_per_week AS "periodsPerWeek",a.active FROM school_staff_teaching_assignments a JOIN school_classes c ON c.id=a.class_id AND c.organization_id=a.organization_id JOIN school_subjects su ON su.id=a.subject_id AND su.organization_id=a.organization_id LEFT JOIN school_streams st ON st.id=a.stream_id AND st.organization_id=a.organization_id WHERE a.organization_id=? AND a.staff_id=? AND a.active=true ORDER BY c.name,st.name,su.name`, org, staffId);
}
async function studentProfile(ctx: SemanticContext, studentId: string) {
  return first(ctx.db, `SELECT s.id,s.admission_number AS "admissionNumber",s.student_number AS "studentNumber",s.first_name AS "firstName",s.middle_name AS "middleName",s.last_name AS "lastName",s.gender,s.status,s.current_class_id AS "classId",c.name AS "className",s.current_stream_id AS "streamId",st.name AS "streamName",s.current_academic_year_id AS "academicYearId" FROM school_students s LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id WHERE s.organization_id=? AND s.id=? AND s.deleted_at IS NULL`, ctx.principal.organizationId, studentId);
}
async function studentEvidence(ctx: SemanticContext, studentId: string, metrics: string[]) {
  const profile = await studentProfile(ctx, studentId);
  if (!profile) throw new Error("Student was not found in this school");
  const evidence: Record<string, unknown> = {};
  if (metrics.includes("profile")) evidence.profile = { verified: true, source: "school_students", data: profile };
  if (metrics.includes("academics")) {
    requireDomain(ctx, "academics");
    evidence.academics = { verified: true, source: "published examinations and recorded marks", data: await cumulativeAcademicSection(ctx.db, ctx.principal.organizationId, studentId) };
  }
  if (metrics.includes("attendance")) {
    requireDomain(ctx, "attendance");
    evidence.attendance = { verified: true, source: "official attendance records", data: await cumulativeAttendanceSection(ctx.db, ctx.principal.organizationId, studentId) };
  }
  if (metrics.includes("finance")) {
    requireDomain(ctx, "finance");
    evidence.finance = { verified: true, source: "authoritative fee charges and payments", data: await cumulativeFinanceSection(ctx.db, ctx.principal.organizationId, studentId) };
  }
  return { studentId, student: profile, evidence };
}

async function queryMetrics(ctx: SemanticContext, args: Row) {
  const entityType = String(args.entityType || "");
  const metrics = Array.isArray(args.metrics) ? args.metrics.map(String) : [];
  if (!metrics.length) throw new Error("At least one metric is required");
  if (entityType === "student") {
    let id = String(args.entityId || "");
    if (!id) {
      const resolved = await resolveEntity(ctx, "student", String(args.query || ""), 10);
      if (resolved.status !== "resolved") return { verified: true, resolution: resolved, evidence: null };
      id = resolved.resolved.id;
    }
    return { verified: true, entityType, ...(await studentEvidence(ctx, id, metrics)) };
  }
  if (entityType === "guardian") {
    let guardianId = String(args.entityId || "");
    let guardian: any = null;
    if (!guardianId) {
      const family = await resolveGuardianFamily(ctx.db, ctx.principal.organizationId, String(args.query || ""), args.gender ? String(args.gender) : undefined);
      if (family.status !== "resolved") return { verified: true, entityType, resolution: family, evidence: null };
      guardian = family.guardian;
      guardianId = family.guardian.id;
    } else {
      guardian = await first(ctx.db, `SELECT id,first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",phone_primary AS "phonePrimary",email FROM school_guardians WHERE organization_id=? AND id=?`, ctx.principal.organizationId, guardianId);
    }
    const relation = await relatedEntities(ctx, "guardian", guardianId, "children");
    const gender = args.gender ? String(args.gender).toLowerCase() : "";
    const children = relation.records.filter((child: any) => !gender || String(child.gender || "").toLowerCase() === gender);
    const requested = metrics.includes("profile") ? metrics : ["profile", ...metrics];
    const evidence = [];
    for (const child of children) evidence.push(await studentEvidence(ctx, child.id, requested));
    return { verified: true, entityType, guardian, childCount: evidence.length, genderFilter: gender || null, children: evidence };
  }
  if (entityType === "staff") {
    requireDomain(ctx, "staff");
    let id = String(args.entityId || "");
    let profile: any = null;
    if (!id) {
      const resolved = await resolveEntity(ctx, "staff", String(args.query || ""), 10);
      if (resolved.status !== "resolved") return { verified: true, entityType, resolution: resolved, evidence: null };
      profile = resolved.resolved; id = resolved.resolved.id;
    } else profile = await first(ctx.db, `SELECT id,staff_number AS "staffNumber",first_name AS "firstName",middle_name AS "middleName",last_name AS "lastName",is_teacher AS "isTeacher",employment_status AS "employmentStatus" FROM school_staff_profiles WHERE organization_id=? AND id=? AND deleted_at IS NULL`, ctx.principal.organizationId, id);
    if (!profile) throw new Error("Staff member was not found in this school");
    const evidence: Record<string, unknown> = {};
    if (metrics.includes("profile")) evidence.profile = { verified: true, source: "school_staff_profiles", data: profile };
    if (metrics.includes("teaching_assignments")) evidence.teachingAssignments = { verified: true, source: "school_staff_teaching_assignments", data: await teachingAssignments(ctx, id) };
    return { verified: true, entityType, staffId: id, staff: profile, evidence };
  }
  throw new Error(`Unsupported metric entity type: ${entityType}`);
}

function minutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) throw new Error(`Invalid time ${value}; expected HH:MM`);
  const h = Number(match[1]), m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) throw new Error(`Invalid time ${value}`);
  return h * 60 + m;
}
function hhmm(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) { return aStart < bEnd && bStart < aEnd; }
export function buildDraftSlots(input: { schoolStart?: string; schoolEnd?: string; periodMinutes?: number; breaks?: Array<{ start: string; end: string; label?: string }> }) {
  const start = minutes(input.schoolStart || "08:00"), end = minutes(input.schoolEnd || "16:00"), length = Math.max(20, Math.min(120, Number(input.periodMinutes) || 40));
  if (end <= start) throw new Error("schoolEnd must be after schoolStart");
  const breaks = (input.breaks?.length ? input.breaks : [{ start: "10:00", end: "10:20", label: "Break" }, { start: "12:20", end: "13:20", label: "Lunch" }]).map(b => ({ ...b, startM: minutes(b.start), endM: minutes(b.end) })).sort((a,b)=>a.startM-b.startM);
  const slots: Array<{ index: number; start: string; end: string }> = [];
  let cursor = start, index = 1;
  while (cursor + length <= end) {
    const crossing = breaks.find(b => overlaps(cursor, cursor + length, b.startM, b.endM));
    if (crossing) { cursor = crossing.endM; continue; }
    slots.push({ index: index++, start: hhmm(cursor), end: hhmm(cursor + length) });
    cursor += length;
  }
  return { slots, breaks: breaks.map(({ startM, endM, ...b }) => b), schoolStart: hhmm(start), schoolEnd: hhmm(end), periodMinutes: length };
}

async function timetablePlan(ctx: SemanticContext, args: Row) {
  requireDomain(ctx, "timetable");
  const org = ctx.principal.organizationId;
  const yearId = String(args.academicYearId || (await first(ctx.db, `SELECT id FROM school_academic_years WHERE organization_id=? AND is_current=true LIMIT 1`, org))?.id || "");
  const termId = String(args.termId || (await first(ctx.db, `SELECT id FROM school_terms WHERE organization_id=? AND is_current=true LIMIT 1`, org))?.id || "");
  if (!yearId || !termId) return { status: "missing_prerequisites", missing: [!yearId ? "current academic year" : null, !termId ? "current term" : null].filter(Boolean), draftOnly: true };
  const assignments = await rows(ctx.db, `SELECT a.id,a.staff_id AS "staffId",CONCAT_WS(' ',sp.first_name,sp.middle_name,sp.last_name) AS "teacherName",a.class_id AS "classId",c.name AS "className",a.stream_id AS "streamId",st.name AS "streamName",a.subject_id AS "subjectId",su.name AS "subjectName",COALESCE(a.periods_per_week,cs.periods_per_week,1) AS "periodsPerWeek" FROM school_staff_teaching_assignments a JOIN school_staff_profiles sp ON sp.id=a.staff_id AND sp.organization_id=a.organization_id JOIN school_classes c ON c.id=a.class_id AND c.organization_id=a.organization_id JOIN school_subjects su ON su.id=a.subject_id AND su.organization_id=a.organization_id LEFT JOIN school_streams st ON st.id=a.stream_id AND st.organization_id=a.organization_id LEFT JOIN school_class_levels cl ON cl.id=c.class_level_id AND cl.organization_id=c.organization_id LEFT JOIN school_class_subjects cs ON cs.organization_id=a.organization_id AND cs.class_level_id=cl.id AND cs.subject_id=a.subject_id AND (cs.academic_year_id=a.academic_year_id OR cs.academic_year_id IS NULL) AND cs.active=true WHERE a.organization_id=? AND a.academic_year_id=? AND a.term_id=? AND a.active=true AND sp.deleted_at IS NULL AND sp.employment_status='active' ORDER BY COALESCE(a.periods_per_week,cs.periods_per_week,1) DESC,c.name,su.name`, org, yearId, termId);
  if (!assignments.length) return { status: "missing_prerequisites", academicYearId: yearId, termId, missing: ["active teacher/class/subject teaching assignments"], advice: "Create/approve teacher teaching assignments with periods_per_week before generating a timetable.", draftOnly: true };
  const config = buildDraftSlots({ schoolStart: args.schoolStart, schoolEnd: args.schoolEnd, periodMinutes: args.periodMinutes, breaks: args.breaks });
  const weekdays = Array.isArray(args.weekdays) && args.weekdays.length ? [...new Set(args.weekdays.map(Number).filter((n:number)=>n>=1&&n<=7))] : [1,2,3,4,5];
  const availability = await rows(ctx.db, `SELECT teacher_staff_id AS "staffId",weekday,starts_at AS "startsAt",ends_at AS "endsAt",available FROM school_teacher_availability WHERE organization_id=?`, org);
  const blocked = availability.filter(a => a.available === false || a.available === 0 || String(a.available) === "false");
  const teacherBusy = new Set<string>(), classBusy = new Set<string>(), entries: Row[] = [], unscheduled: Row[] = [];
  const dayLoad = new Map<string, number>();
  const ordered = assignments.flatMap(a => Array.from({ length: Math.max(1, Number(a.periodsPerWeek) || 1) }, (_, occurrence) => ({ ...a, occurrence: occurrence + 1 })));
  for (const lesson of ordered) {
    let placed: Row | null = null;
    const dayOrder = [...weekdays].sort((a,b)=>(dayLoad.get(`${lesson.assignmentId || lesson.id}:${a}`)||0)-(dayLoad.get(`${lesson.assignmentId || lesson.id}:${b}`)||0));
    for (const weekday of dayOrder) {
      for (const slot of config.slots) {
        const teacherKey = `${lesson.staffId}:${weekday}:${slot.start}`, classKey = `${lesson.classId}:${lesson.streamId || "*"}:${weekday}:${slot.start}`;
        if (teacherBusy.has(teacherKey) || classBusy.has(classKey)) continue;
        const ss = minutes(slot.start), ee = minutes(slot.end);
        const unavailable = blocked.some(a => a.staffId === lesson.staffId && Number(a.weekday) === weekday && overlaps(ss, ee, minutes(String(a.startsAt).slice(0,5)), minutes(String(a.endsAt).slice(0,5))));
        if (unavailable) continue;
        placed = { assignmentId: lesson.id, occurrence: lesson.occurrence, classId: lesson.classId, className: lesson.className, streamId: lesson.streamId || null, streamName: lesson.streamName || null, subjectId: lesson.subjectId, subjectName: lesson.subjectName, teacherStaffId: lesson.staffId, teacherName: lesson.teacherName, weekday, startsAt: slot.start, endsAt: slot.end };
        teacherBusy.add(teacherKey); classBusy.add(classKey); dayLoad.set(`${lesson.id}:${weekday}`, (dayLoad.get(`${lesson.id}:${weekday}`)||0)+1); break;
      }
      if (placed) break;
    }
    if (placed) entries.push(placed); else unscheduled.push({ assignmentId: lesson.id, occurrence: lesson.occurrence, className: lesson.className, streamName: lesson.streamName || null, subjectName: lesson.subjectName, teacherName: lesson.teacherName, reason: "No conflict-free slot remained within the draft configuration" });
  }
  const assumptions = [
    !args.schoolStart ? "schoolStart defaulted to 08:00" : null,
    !args.schoolEnd ? "schoolEnd defaulted to 16:00" : null,
    !args.periodMinutes ? "period duration defaulted to 40 minutes" : null,
    !(Array.isArray(args.weekdays) && args.weekdays.length) ? "teaching days defaulted to Monday-Friday" : null,
    !(Array.isArray(args.breaks) && args.breaks.length) ? "breaks defaulted to 10:00-10:20 and 12:20-13:20" : null,
  ].filter(Boolean);
  return {
    status: unscheduled.length ? "draft_with_conflicts" : "draft_valid",
    draftOnly: true, persisted: false, academicYearId: yearId, termId,
    configuration: { ...config, weekdays, source: assumptions.length ? "system_default_plus_request" : "user_request" },
    assumptions,
    hardRules: ["teacher cannot overlap", "class/stream cannot overlap", "recorded teacher unavailability is respected"],
    assignmentCount: assignments.length, lessonCount: ordered.length, scheduledCount: entries.length, unscheduledCount: unscheduled.length,
    entries, unscheduled,
    nextStep: "Review this draft. To save it, use governed Ledgerly timetable API actions; do not claim it is saved or published until those actions are approved and executed.",
  };
}

export async function executeSemanticTool(ctx: SemanticContext, name: SemanticToolName, raw: unknown) {
  if (!enabled(ctx.agent, name, ctx.requestedTools)) throw new Error(`${name} is not enabled for this employee`);
  const args = raw && typeof raw === "object" ? raw as Row : {};
  if (name === "semantic_capabilities") return {
    employee: ctx.agent.key,
    semanticLayerVersion: 1,
    domains: DOMAIN_ACCESS[ctx.agent.key] || [],
    entities: ["student", "guardian", "staff", "class", "stream", "subject", "academic_year", "term", "department", "timetable"],
    relationships: ["guardian→children", "student→guardians", "class→students", "staff→teaching_assignments"],
    metricFamilies: ["profile", ...(hasDomain(ctx,"academics")?["academics"]:[]), ...(hasDomain(ctx,"attendance")?["attendance"]:[]), ...(hasDomain(ctx,"finance")?["finance"]:[]), ...(hasDomain(ctx,"staff")?["teaching_assignments"]:[])],
    principles: ["tenant-scoped", "verified records only", "ambiguous entities are never guessed", "writes remain governed Action Center actions", "timetable drafts are deterministic and unsaved until approved"],
  };
  if (name === "resolve_entity") return resolveEntity(ctx, String(args.entityType || ""), String(args.query || ""), args.limit);
  if (name === "get_related_entities") return relatedEntities(ctx, String(args.sourceType || ""), String(args.sourceId || ""), String(args.relation || ""));
  if (name === "query_metrics") return queryMetrics(ctx, args);
  if (name === "plan_timetable") return timetablePlan(ctx, args);
  throw new Error(`Unknown semantic tool: ${name}`);
}
